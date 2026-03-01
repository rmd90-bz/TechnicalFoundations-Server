const app = require('./index.js');
const supertest = require('supertest');
const request = supertest(app);
const sharp = require('sharp');

// Create a minimal valid PNG test image (1x1 white pixel)
async function createTestImage() {
  return sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  }).png().toBuffer();
}

describe('GET /transcribe/document-types', () => {
  test('returns list of supported document types', async () => {
    const res = await request.get('/transcribe/document-types');
    expect(res.status).toBe(200);
    expect(res.body.documentTypes).toBeDefined();
    expect(Array.isArray(res.body.documentTypes)).toBe(true);
    expect(res.body.documentTypes.length).toBe(3);
  });

  test('includes historical-civil-registry as recommended', async () => {
    const res = await request.get('/transcribe/document-types');
    const civilRegistry = res.body.documentTypes.find(
      dt => dt.id === 'historical-civil-registry'
    );
    expect(civilRegistry).toBeDefined();
    expect(civilRegistry.recommended).toBe(true);
  });
});

describe('POST /transcribe', () => {
  test('returns 400 when no images are uploaded', async () => {
    const res = await request.post('/transcribe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No images uploaded/);
  });

  test('returns 503 when ANTHROPIC_API_KEY is not set', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const imageBuffer = await createTestImage();

    const res = await request
      .post('/transcribe')
      .attach('images', imageBuffer, 'test.png');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);

    // Restore
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('rejects unsupported file types', async () => {
    const res = await request
      .post('/transcribe')
      .attach('images', Buffer.from('not a real file'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      });

    expect(res.status).toBe(400);
  });
});
