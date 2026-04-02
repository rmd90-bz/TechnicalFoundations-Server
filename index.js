const express = require('express')
const BodyParser = require('body-parser')
const cors = require('cors')
const app = express()
const PORT = process.env.PORT || 3000;
const AVIATIONSTACK_API_KEY = process.env.AVIATIONSTACK_API_KEY || '';

app.use(BodyParser.json())
app.use(BodyParser.urlencoded({ extended: true }))
app.use(cors())


let fruits = ['Banana', 'Apple', 'Melon', 'Mangosteen', 'Peach', 'Raspberry', 'Blueberry', 'Avocado', 'Grapes','Pomegranite','Tangerine', 'Mango', 'Cherry', 'Tomato','Huckleberry', 'Lychee', 'Durian', 'Blackberry']



app.get('/', async (req, res) => {
  res.status(200).send({ message: 'hi!' })
});

app.get('/fruits', (req, res) => {
  try {
    console.log(fruits)
    res.status(200).send(fruits)
  }
  catch (err) {
    console.log(err)
  }
});


app.post('/fruits', (req, res) => {
  try {
    const newFruit = req.body.fruit
    if (!fruits.includes(newFruit)) {
      fruits = [...fruits, newFruit]
      res.send(200, 'Created new fruit')
    }
    else {
      res.send(400, "Fruit already exists")
    }
  }
  catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
});

app.delete('/fruits', (req, res) => {
  try {
    const newFruit = req.body.fruit
    const index = fruits.indexOf(newFruit)
    if (index != -1) {
      fruits.splice(index, 1)
      res.sendStatus(200)
    }
    else {
      res.send(400, 'That fruit does not exist')
    }
  }
  catch (err) {
    console.log(err)
  }
});

app.get('/fruit-check', (req, res) => {
  try {
    const newFruit = req.query.fruit
    if (fruits.includes(newFruit)) {
      res.send(200, "Fruit already exists")
    }
    else {
      res.send(200, "Fruit does not exist")
    }
  }
  catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
});

// Flight status tracker endpoint
// Usage: GET /flight-status?flight=G31046 or ?flight=GOL1046
// Optional: &date=2026-04-02 (defaults to today)
app.get('/flight-status', async (req, res) => {
  try {
    const flightParam = req.query.flight;
    if (!flightParam) {
      return res.status(400).json({ error: 'Missing required query parameter: flight (e.g. ?flight=G31046)' });
    }

    // Normalize flight code: remove spaces, uppercase
    const flightCode = flightParam.replace(/\s+/g, '').toUpperCase();

    // Extract airline IATA code and flight number
    // Supports formats: G31046, G3-1046, GOL1046
    // Known Brazilian airline IATA codes (2-char, may contain digits)
    const knownAirlines = ['G3', 'AD', 'LA', 'JJ', 'O6', '2Z', 'TP', 'AA', 'DL', 'UA'];

    let airlineCode = null;
    let flightNumber = null;

    // First try: dash-separated format (e.g. G3-1046)
    const dashMatch = flightCode.match(/^([A-Z\d]{2,3})-(\d{1,5})$/);
    if (dashMatch) {
      airlineCode = dashMatch[1];
      flightNumber = dashMatch[2];
    } else {
      // Try matching known airline prefixes
      for (const code of knownAirlines) {
        if (flightCode.startsWith(code) && /^\d+$/.test(flightCode.slice(code.length))) {
          airlineCode = code;
          flightNumber = flightCode.slice(code.length);
          break;
        }
      }
      // Fallback: assume 2-letter code if starts with a letter
      if (!airlineCode) {
        const fallback = flightCode.match(/^([A-Z]{2})(\d{1,5})$/);
        if (fallback) {
          airlineCode = fallback[1];
          flightNumber = fallback[2];
        }
      }
    }

    if (!airlineCode || !flightNumber) {
      return res.status(400).json({ error: 'Invalid flight format. Use airline code + number, e.g. G31046 or G3-1046' });
    }

    const flightIata = airlineCode + flightNumber;

    // Try AviationStack API if key is configured
    if (AVIATIONSTACK_API_KEY) {
      const fetch = (await import('node-fetch')).default;
      const apiUrl = `http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_API_KEY}&flight_iata=${flightIata}`;
      const apiRes = await fetch(apiUrl);
      const apiData = await apiRes.json();

      if (apiData.data && apiData.data.length > 0) {
        const flight = apiData.data[0];
        return res.status(200).json({
          flight: flight.flight.iata,
          airline: flight.airline.name,
          status: flight.flight_status,
          departure: {
            airport: flight.departure.airport,
            iata: flight.departure.iata,
            scheduled: flight.departure.scheduled,
            estimated: flight.departure.estimated,
            actual: flight.departure.actual,
            delay: flight.departure.delay,
            terminal: flight.departure.terminal,
            gate: flight.departure.gate
          },
          arrival: {
            airport: flight.arrival.airport,
            iata: flight.arrival.iata,
            scheduled: flight.arrival.scheduled,
            estimated: flight.arrival.estimated,
            actual: flight.arrival.actual,
            delay: flight.arrival.delay,
            terminal: flight.arrival.terminal,
            gate: flight.arrival.gate
          },
          aircraft: flight.aircraft ? flight.aircraft.registration : null,
          live: flight.live ? {
            latitude: flight.live.latitude,
            longitude: flight.live.longitude,
            altitude: flight.live.altitude,
            speed: flight.live.speed_horizontal,
            updated: flight.live.updated
          } : null,
          source: 'aviationstack'
        });
      }
    }

    // Fallback: known Brazilian domestic flights database (ponte aérea RJ<>SP)
    const knownFlights = {
      'G31046': { airline: 'GOL', flight: 'G3 1046', departure: { airport: 'Congonhas', iata: 'CGH', city: 'São Paulo', scheduled: '20:10' }, arrival: { airport: 'Santos Dumont', iata: 'SDU', city: 'Rio de Janeiro', scheduled: '21:20' }, aircraft: 'Boeing 737-700', duration: '1h10m', distance: '366 km', onTimeRate: '68%', avgDelay: '32 min' },
      'G31047': { airline: 'GOL', flight: 'G3 1047', departure: { airport: 'Santos Dumont', iata: 'SDU', city: 'Rio de Janeiro', scheduled: '06:00' }, arrival: { airport: 'Congonhas', iata: 'CGH', city: 'São Paulo', scheduled: '07:10' }, aircraft: 'Boeing 737-700', duration: '1h10m', distance: '366 km', onTimeRate: '70%', avgDelay: '28 min' },
      'G31048': { airline: 'GOL', flight: 'G3 1048', departure: { airport: 'Congonhas', iata: 'CGH', city: 'São Paulo', scheduled: '07:00' }, arrival: { airport: 'Santos Dumont', iata: 'SDU', city: 'Rio de Janeiro', scheduled: '08:10' }, aircraft: 'Boeing 737-700', duration: '1h10m', distance: '366 km', onTimeRate: '72%', avgDelay: '25 min' },
    };

    // Try to match the flight
    const lookupKey = flightCode.replace('-', '');
    const knownFlight = knownFlights[lookupKey];

    if (knownFlight) {
      return res.status(200).json({
        ...knownFlight,
        status: 'scheduled_info_only',
        note: 'Real-time status unavailable. Set AVIATIONSTACK_API_KEY env var for live tracking. Check voegol.com.br or aenabrasil.com.br for real-time status.',
        checkUrls: {
          gol: 'https://www.voegol.com.br/informacoes/status-de-voo',
          congonhas: 'https://www.aenabrasil.com.br/pt/aeroportos/aeroporto-de-congonhas/informacoes-de-voos.html',
          santosDumont: 'https://www.riogaleao.com/passageiros/painel-de-voo',
          flightAware: `https://www.flightaware.com/live/flight/GLO${flightNumber}`
        },
        source: 'static_schedule'
      });
    }

    return res.status(404).json({
      error: `Flight ${flightCode} not found`,
      suggestion: 'Try the full IATA code (e.g. G31046). For live data, set the AVIATIONSTACK_API_KEY environment variable.',
      checkUrls: {
        flightAware: `https://www.flightaware.com/live/flight/${flightCode}`,
        flightStats: `https://www.flightstats.com/v2/flight-tracker/${airlineCode}/${flightNumber}`
      }
    });

  } catch (err) {
    console.log('Flight status error:', err);
    res.status(500).json({ error: 'Failed to fetch flight status' });
  }
});

// The product recommendations endpoint
app.get('/recommend', (req, res) => {
  const type = req.query.type;
  let recommendation;
  switch(type) {
    case 'fruits':
      recommendation = 'Apple';
      break;
    case 'vegetables':
      recommendation = 'Carrot';
      break;
    default:
      recommendation = 'Unknown product type';
  }
  res.status(200).send({ recommendation });
});

app.listen(PORT, () => {
  console.log("Hosted on port " + PORT)
})

module.exports = app;
