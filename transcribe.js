const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const Anthropic = require('@anthropic-ai/sdk').default;
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for image uploads with size and type validation
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Accepted: JPEG, PNG, WebP, GIF, TIFF`));
    }
  }
});

// Preprocess image for optimal OCR/transcription quality
async function preprocessImage(buffer, options = {}) {
  const {
    enhanceContrast = true,
    sharpen = true,
    maxWidth = 4096,
    maxHeight = 4096,
    outputFormat = 'png'
  } = options;

  let pipeline = sharp(buffer);

  // Get metadata to make smart decisions
  const metadata = await pipeline.metadata();

  // Resize if too large (preserving aspect ratio)
  if (metadata.width > maxWidth || metadata.height > maxHeight) {
    pipeline = pipeline.resize(maxWidth, maxHeight, { fit: 'inside' });
  }

  // Enhance contrast for faded historical documents
  if (enhanceContrast) {
    pipeline = pipeline.normalize(); // Auto-levels contrast
  }

  // Sharpen to make handwriting more legible
  if (sharpen) {
    pipeline = pipeline.sharpen({ sigma: 1.5 });
  }

  // Convert to PNG for lossless quality
  pipeline = pipeline.toFormat(outputFormat);

  return pipeline.toBuffer();
}

// Build the transcription prompt based on document type
function buildTranscriptionPrompt(documentType, language) {
  const prompts = {
    'historical-civil-registry': `You are an expert paleographer and historian specializing in Brazilian civil registry documents from the 19th and early 20th centuries.

TASK: Transcribe this handwritten document with absolute precision.

RULES:
1. Transcribe EVERY word exactly as written, preserving the original spelling (e.g., "n'este", "Districto", "assignado")
2. Maintain the original paragraph structure
3. Mark any illegible or uncertain words with [?] or [word?] if you have a guess
4. Preserve abbreviations as written (e.g., "Snr.", "d'")
5. Note any corrections, strikethroughs, or marginal annotations
6. Include all names, dates, and places with extreme care
7. Identify the document type (birth, marriage, death registration)
8. For signatures at the end, list each one separately

OUTPUT FORMAT:
---
DOCUMENT TYPE: [type]
REGISTRY: [registry name/district]
DATE: [date of registration]
ENTRY NUMBER: [number if visible]

FULL TRANSCRIPTION:
[complete transcription preserving original formatting]

KEY INFORMATION EXTRACTED:
- Person registered: [name]
- Birth/Event date: [date]
- Parents: [names]
- Grandparents (paternal): [names]
- Grandparents (maternal): [names]
- Witnesses: [names]
- Registrar: [name]

NOTES:
[any observations about document condition, illegible sections, or corrections]
---`,

    'historical-general': `You are an expert paleographer specializing in historical handwritten documents.

TASK: Transcribe this handwritten document with maximum accuracy.

RULES:
1. Transcribe every word exactly as written, preserving original spelling and grammar
2. Mark illegible or uncertain words with [?] or [word?]
3. Note any corrections, strikethroughs, or marginal notes
4. Preserve the original layout and paragraph structure
5. For signatures, list each separately

Provide the complete transcription followed by any notes about the document.`,

    'general': `Transcribe this document with maximum accuracy. Preserve the original text exactly as written. Mark any illegible or uncertain portions with [?].`
  };

  const languageNote = language && language !== 'auto'
    ? `\n\nIMPORTANT: This document is written in ${language}. Transcribe in the original language.`
    : '\n\nIMPORTANT: Detect the language automatically and transcribe in the original language.';

  return (prompts[documentType] || prompts['general']) + languageNote;
}

// Transcribe using Claude Vision API (best for handwritten documents)
async function transcribeWithClaude(imageBuffers, options = {}) {
  const {
    documentType = 'historical-civil-registry',
    language = 'auto',
    model = 'claude-sonnet-4-20250514'
  } = options;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required for AI transcription');
  }

  const client = new Anthropic({ apiKey });

  // Build content array with all images
  const content = [];
  for (const buf of imageBuffers) {
    const base64 = buf.toString('base64');
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: base64
      }
    });
  }

  content.push({
    type: 'text',
    text: buildTranscriptionPrompt(documentType, language)
  });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content
      }
    ]
  });

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

// POST /transcribe - Transcribe uploaded images
router.post('/', (req, res) => {
  const uploadMiddleware = upload.array('images', 10);

  uploadMiddleware(req, res, async (uploadErr) => {
    // Handle multer errors (file type, size, etc.)
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No images uploaded. Send images as multipart form data with field name "images".' });
      }

      const documentType = req.body.documentType || 'historical-civil-registry';
      const language = req.body.language || 'auto';
      const enhance = req.body.enhance !== 'false'; // default true

      // Preprocess all images
      const processedImages = await Promise.all(
        req.files.map(file => preprocessImage(file.buffer, {
          enhanceContrast: enhance,
          sharpen: enhance
        }))
      );

      // Transcribe using Claude Vision
      const transcription = await transcribeWithClaude(processedImages, {
        documentType,
        language
      });

      res.status(200).json({
        transcription,
        metadata: {
          imagesProcessed: req.files.length,
          documentType,
          language,
          enhanced: enhance,
          model: 'claude-sonnet-4-20250514'
        }
      });
    } catch (err) {
      console.error('Transcription error:', err);

      if (err.message && err.message.includes('ANTHROPIC_API_KEY')) {
        return res.status(503).json({ error: err.message });
      }

      res.status(500).json({ error: 'Transcription failed. Please try again.' });
    }
  });
});

// GET /transcribe/document-types - List supported document types
router.get('/document-types', (req, res) => {
  res.status(200).json({
    documentTypes: [
      {
        id: 'historical-civil-registry',
        name: 'Historical Civil Registry (Brazil)',
        description: 'Birth, marriage, and death records from Brazilian civil registries (19th-20th century)',
        recommended: true
      },
      {
        id: 'historical-general',
        name: 'Historical Document (General)',
        description: 'General historical handwritten documents'
      },
      {
        id: 'general',
        name: 'General Document',
        description: 'Any printed or handwritten document'
      }
    ]
  });
});

module.exports = router;
