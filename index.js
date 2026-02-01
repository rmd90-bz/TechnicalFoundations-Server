const express = require('express')
const BodyParser = require('body-parser')
const cors = require('cors')
const flightService = require('./flightService')
const app = express()
const PORT = process.env.PORT || 3000;

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

// ============================================
// FLIGHT TRACKING ENDPOINTS
// ============================================

/**
 * GET /flights/:flightNumber
 * Busca informações de um voo pelo número
 * Ex: GET /flights/G31145
 */
app.get('/flights/:flightNumber', async (req, res) => {
  try {
    const { flightNumber } = req.params;

    if (!flightNumber || flightNumber.length < 3) {
      return res.status(400).json({
        error: 'Invalid flight number',
        example: 'G31145 or GOL1145'
      });
    }

    const flightInfo = await flightService.getFlightInfo(flightNumber);
    res.status(200).json(flightInfo);
  } catch (error) {
    console.error('Error fetching flight:', error);
    res.status(500).json({ error: 'Failed to fetch flight information' });
  }
});

/**
 * GET /flights/:flightNumber/inbound
 * Encontra o voo de origem (o voo anterior da mesma aeronave)
 * Útil para prever atrasos - se o avião está atrasado chegando, seu voo vai atrasar
 * Ex: GET /flights/G31145/inbound?airport=SDU
 */
app.get('/flights/:flightNumber/inbound', async (req, res) => {
  try {
    const { flightNumber } = req.params;
    const { airport } = req.query;

    if (!flightNumber || flightNumber.length < 3) {
      return res.status(400).json({
        error: 'Invalid flight number',
        example: 'G31145'
      });
    }

    const departureAirport = airport || 'SDU'; // Default Santos Dumont
    const inboundInfo = await flightService.findInboundFlight(flightNumber, departureAirport);

    res.status(200).json(inboundInfo);
  } catch (error) {
    console.error('Error finding inbound flight:', error);
    res.status(500).json({ error: 'Failed to find inbound flight' });
  }
});

/**
 * GET /airports/:code/arrivals
 * Lista as chegadas recentes em um aeroporto
 * Ex: GET /airports/SDU/arrivals?hours=3
 */
app.get('/airports/:code/arrivals', async (req, res) => {
  try {
    const { code } = req.params;
    const hours = parseInt(req.query.hours) || 3;

    if (!code || code.length < 3) {
      return res.status(400).json({
        error: 'Invalid airport code',
        example: 'SDU, GIG, CGH, GRU'
      });
    }

    const arrivals = await flightService.getAirportArrivals(code, Math.min(hours, 12));

    if (!arrivals) {
      return res.status(404).json({
        error: 'Could not fetch arrivals. Airport may not exist or API unavailable.',
        tip: 'Use IATA (SDU) or ICAO (SBRJ) codes'
      });
    }

    res.status(200).json({
      airport: code,
      icao: flightService.convertToICAO(code),
      hoursBack: hours,
      count: arrivals.length,
      arrivals
    });
  } catch (error) {
    console.error('Error fetching arrivals:', error);
    res.status(500).json({ error: 'Failed to fetch airport arrivals' });
  }
});

/**
 * GET /aircraft/:icao24/history
 * Busca o histórico de voos de uma aeronave específica
 * Ex: GET /aircraft/e49406/history?hours=6
 */
app.get('/aircraft/:icao24/history', async (req, res) => {
  try {
    const { icao24 } = req.params;
    const hours = parseInt(req.query.hours) || 6;

    if (!icao24 || icao24.length < 6) {
      return res.status(400).json({
        error: 'Invalid ICAO24 address',
        tip: 'ICAO24 is a 6-character hex code like "e49406"'
      });
    }

    const history = await flightService.getAircraftHistory(icao24, Math.min(hours, 24));

    if (!history) {
      return res.status(404).json({
        error: 'Could not fetch aircraft history',
        tip: 'Aircraft may not have flown recently or ICAO24 is invalid'
      });
    }

    res.status(200).json({
      icao24,
      hoursBack: hours,
      flights: history
    });
  } catch (error) {
    console.error('Error fetching aircraft history:', error);
    res.status(500).json({ error: 'Failed to fetch aircraft history' });
  }
});

/**
 * GET /airports
 * Lista aeroportos brasileiros suportados
 */
app.get('/airports', (req, res) => {
  res.status(200).json(flightService.getBrazilianAirports());
});

app.listen(PORT, () => {
  console.log("Hosted on port " + PORT)
})

module.exports = app;
