/**
 * Flight Tracking Service
 * Integrates with multiple flight data APIs to provide real-time flight information
 */

const https = require('https');
const http = require('http');

/**
 * Helper function to make HTTP/HTTPS requests (works with CommonJS)
 */
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const req = client.get(url, {
      headers: {
        'User-Agent': 'FlightTracker/1.0',
        ...options.headers
      },
      timeout: options.timeout || 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data))
          });
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Cache para reduzir chamadas à API
const flightCache = new Map();
const CACHE_TTL = 60000; // 1 minuto

/**
 * Busca informações de um voo pelo número
 * @param {string} flightNumber - Ex: "G31145", "GOL1145", "LA3456"
 */
async function getFlightInfo(flightNumber) {
  // Normaliza o número do voo (remove espaços, uppercase)
  const normalized = flightNumber.replace(/\s+/g, '').toUpperCase();

  // Verifica cache
  const cached = flightCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Tenta múltiplas fontes de dados
  let flightData = null;

  // 1. Tenta AviationStack (se API key disponível)
  if (process.env.AVIATIONSTACK_API_KEY) {
    flightData = await fetchFromAviationStack(normalized);
  }

  // 2. Fallback para OpenSky (gratuito, mas limitado)
  if (!flightData) {
    flightData = await fetchFromOpenSky(normalized);
  }

  // 3. Se ainda não temos dados, retorna estrutura básica
  if (!flightData) {
    flightData = {
      flightNumber: normalized,
      status: 'unknown',
      message: 'Flight data not available. Try again later or check flight number.',
      sources: []
    };
  }

  // Salva no cache
  flightCache.set(normalized, { data: flightData, timestamp: Date.now() });

  return flightData;
}

/**
 * Busca dados do AviationStack API
 */
async function fetchFromAviationStack(flightNumber) {
  const apiKey = process.env.AVIATIONSTACK_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flightNumber}`;

    const response = await httpGet(url, { timeout: 10000 });
    const data = await response.json();

    if (data.data && data.data.length > 0) {
      const flight = data.data[0];
      return {
        flightNumber: flight.flight?.iata || flightNumber,
        airline: {
          name: flight.airline?.name,
          iata: flight.airline?.iata,
          icao: flight.airline?.icao
        },
        departure: {
          airport: flight.departure?.airport,
          iata: flight.departure?.iata,
          terminal: flight.departure?.terminal,
          gate: flight.departure?.gate,
          scheduledTime: flight.departure?.scheduled,
          estimatedTime: flight.departure?.estimated,
          actualTime: flight.departure?.actual,
          delay: flight.departure?.delay
        },
        arrival: {
          airport: flight.arrival?.airport,
          iata: flight.arrival?.iata,
          terminal: flight.arrival?.terminal,
          gate: flight.arrival?.gate,
          scheduledTime: flight.arrival?.scheduled,
          estimatedTime: flight.arrival?.estimated,
          actualTime: flight.arrival?.actual,
          delay: flight.arrival?.delay
        },
        aircraft: {
          registration: flight.aircraft?.registration,
          iata: flight.aircraft?.iata,
          icao: flight.aircraft?.icao,
          icao24: flight.aircraft?.icao24
        },
        status: flight.flight_status,
        live: flight.live ? {
          latitude: flight.live.latitude,
          longitude: flight.live.longitude,
          altitude: flight.live.altitude,
          speed: flight.live.speed_horizontal,
          heading: flight.live.direction
        } : null,
        source: 'aviationstack'
      };
    }
  } catch (error) {
    console.error('AviationStack API error:', error.message);
  }

  return null;
}

/**
 * Busca dados do OpenSky Network (gratuito)
 */
async function fetchFromOpenSky(flightNumber) {
  try {
    // OpenSky retorna todos os voos ativos - precisamos filtrar
    const response = await httpGet('https://opensky-network.org/api/states/all', {
      timeout: 15000
    });

    if (!response.ok) {
      console.error('OpenSky API returned:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.states) {
      // Procura pelo callsign que corresponde ao número do voo
      // Callsign pode ser "GOL1145" ou "G31145" etc
      const normalizedSearch = flightNumber.replace(/[^A-Z0-9]/g, '');

      const matchingFlight = data.states.find(state => {
        const callsign = (state[1] || '').trim().replace(/[^A-Z0-9]/g, '');
        return callsign === normalizedSearch ||
               callsign.includes(normalizedSearch) ||
               normalizedSearch.includes(callsign);
      });

      if (matchingFlight) {
        return {
          flightNumber: matchingFlight[1]?.trim() || flightNumber,
          aircraft: {
            icao24: matchingFlight[0],
            registration: null, // OpenSky não fornece
            country: matchingFlight[2]
          },
          live: {
            latitude: matchingFlight[6],
            longitude: matchingFlight[5],
            altitude: matchingFlight[7], // metros
            speed: matchingFlight[9], // m/s
            heading: matchingFlight[10],
            verticalRate: matchingFlight[11],
            onGround: matchingFlight[8]
          },
          status: matchingFlight[8] ? 'on_ground' : 'in_flight',
          lastUpdate: new Date(matchingFlight[4] * 1000).toISOString(),
          source: 'opensky'
        };
      }
    }
  } catch (error) {
    console.error('OpenSky API error:', error.message);
  }

  return null;
}

/**
 * Busca chegadas em um aeroporto para encontrar o voo de origem
 * @param {string} airportCode - Código ICAO do aeroporto (ex: "SBRJ" para SDU)
 * @param {number} hours - Quantas horas para trás buscar (padrão 3)
 */
async function getAirportArrivals(airportCode, hours = 3) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (hours * 3600);

    // OpenSky usa código ICAO (SBRJ = Santos Dumont, SBGL = Galeão)
    const icaoCode = convertToICAO(airportCode);

    const url = `https://opensky-network.org/api/flights/arrival?airport=${icaoCode}&begin=${begin}&end=${now}`;

    const response = await httpGet(url, { timeout: 15000 });

    if (!response.ok) {
      console.error('OpenSky arrivals API returned:', response.status);
      return null;
    }

    const flights = await response.json();

    return flights.map(f => ({
      icao24: f.icao24,
      callsign: f.callsign?.trim(),
      departureAirport: f.estDepartureAirport,
      arrivalAirport: f.estArrivalAirport,
      departureTime: f.firstSeen ? new Date(f.firstSeen * 1000).toISOString() : null,
      arrivalTime: f.lastSeen ? new Date(f.lastSeen * 1000).toISOString() : null
    }));

  } catch (error) {
    console.error('Error fetching arrivals:', error.message);
    return null;
  }
}

/**
 * Busca o histórico de uma aeronave para encontrar o voo de origem (inbound)
 * @param {string} icao24 - Código ICAO24 da aeronave
 */
async function getAircraftHistory(icao24, hours = 6) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (hours * 3600);

    const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao24.toLowerCase()}&begin=${begin}&end=${now}`;

    const response = await httpGet(url, { timeout: 15000 });

    if (!response.ok) {
      return null;
    }

    const flights = await response.json();

    // Ordena por tempo de partida (mais recente primeiro)
    return flights
      .map(f => ({
        icao24: f.icao24,
        callsign: f.callsign?.trim(),
        departureAirport: f.estDepartureAirport,
        arrivalAirport: f.estArrivalAirport,
        departureTime: f.firstSeen ? new Date(f.firstSeen * 1000).toISOString() : null,
        arrivalTime: f.lastSeen ? new Date(f.lastSeen * 1000).toISOString() : null
      }))
      .sort((a, b) => new Date(b.departureTime) - new Date(a.departureTime));

  } catch (error) {
    console.error('Error fetching aircraft history:', error.message);
    return null;
  }
}

/**
 * Encontra o voo de origem (inbound) para um voo específico
 * Isso ajuda a prever atrasos - se o avião está atrasado chegando,
 * o próximo voo vai atrasar também.
 */
async function findInboundFlight(flightNumber, departureAirport) {
  // 1. Primeiro, pega info do voo para descobrir a aeronave
  const flightInfo = await getFlightInfo(flightNumber);

  if (!flightInfo || !flightInfo.aircraft?.icao24) {
    // Se não temos o icao24, tenta buscar nas chegadas do aeroporto
    const arrivals = await getAirportArrivals(departureAirport, 4);

    if (arrivals && arrivals.length > 0) {
      // Retorna as últimas chegadas que podem ser candidatas
      return {
        flightNumber,
        departureAirport,
        inboundFlight: null,
        message: 'Could not determine exact aircraft. Here are recent arrivals that may be your inbound flight:',
        recentArrivals: arrivals.slice(0, 10),
        tip: 'Look for the arrival that matches your departure time minus ~45 minutes turnaround'
      };
    }

    return {
      flightNumber,
      departureAirport,
      inboundFlight: null,
      message: 'Could not find aircraft information. The flight may not have departed yet.',
      source: flightInfo?.source || 'none'
    };
  }

  // 2. Busca o histórico da aeronave
  const history = await getAircraftHistory(flightInfo.aircraft.icao24);

  if (history && history.length > 1) {
    // O voo anterior ao atual é o inbound
    const inbound = history[1]; // índice 0 é o voo atual, 1 é o anterior

    return {
      flightNumber,
      departureAirport,
      aircraft: flightInfo.aircraft,
      currentFlight: {
        callsign: history[0]?.callsign,
        status: flightInfo.status,
        live: flightInfo.live
      },
      inboundFlight: inbound ? {
        callsign: inbound.callsign,
        from: inbound.departureAirport,
        to: inbound.arrivalAirport,
        departureTime: inbound.departureTime,
        arrivalTime: inbound.arrivalTime
      } : null,
      delayAnalysis: inbound ? analyzeDelay(inbound.arrivalTime, flightInfo) : null,
      source: flightInfo.source
    };
  }

  return {
    flightNumber,
    departureAirport,
    aircraft: flightInfo.aircraft,
    inboundFlight: null,
    message: 'No previous flight found. This may be the first flight of the day for this aircraft.',
    source: flightInfo.source
  };
}

/**
 * Analisa possível atraso baseado no voo de origem
 */
function analyzeDelay(inboundArrivalTime, scheduledDeparture) {
  if (!inboundArrivalTime) return null;

  const arrival = new Date(inboundArrivalTime);
  const now = new Date();

  // Tempo mínimo de turnaround (45 minutos para voos domésticos)
  const minTurnaround = 45 * 60 * 1000; // 45 min em ms

  const timeSinceArrival = now - arrival;
  const turnaroundRemaining = minTurnaround - timeSinceArrival;

  if (turnaroundRemaining > 0) {
    return {
      status: 'potential_delay',
      message: `Aircraft arrived ${Math.floor(timeSinceArrival / 60000)} minutes ago. Minimum turnaround is 45 minutes.`,
      estimatedDelay: Math.ceil(turnaroundRemaining / 60000),
      inboundArrivalTime
    };
  }

  return {
    status: 'on_time',
    message: 'Aircraft has completed turnaround. Flight should depart on time.',
    inboundArrivalTime
  };
}

/**
 * Converte código IATA para ICAO
 */
function convertToICAO(code) {
  const iataToIcao = {
    // Brasil - principais aeroportos
    'SDU': 'SBRJ', // Santos Dumont
    'GIG': 'SBGL', // Galeão
    'CGH': 'SBSP', // Congonhas
    'GRU': 'SBGR', // Guarulhos
    'BSB': 'SBBR', // Brasília
    'CNF': 'SBCF', // Confins
    'SSA': 'SBSV', // Salvador
    'REC': 'SBRF', // Recife
    'FOR': 'SBFZ', // Fortaleza
    'POA': 'SBPA', // Porto Alegre
    'CWB': 'SBCT', // Curitiba
    'VCP': 'SBKP', // Campinas
    'FLN': 'SBFL', // Florianópolis
    'MAO': 'SBEG', // Manaus
    'BEL': 'SBBE', // Belém
    'NAT': 'SBNT', // Natal
    'MCZ': 'SBMO', // Maceió
    'VIX': 'SBVT', // Vitória
    'JPA': 'SBJP', // João Pessoa
    'AJU': 'SBAJ', // Aracaju
    'SLZ': 'SBSL', // São Luís
    'THE': 'SBTE', // Teresina
    'CGB': 'SBCY', // Cuiabá
    'CGR': 'SBCG', // Campo Grande
    'GYN': 'SBGO', // Goiânia
  };

  // Se já é ICAO (4 letras começando com SB), retorna
  if (code.length === 4 && code.startsWith('SB')) {
    return code;
  }

  return iataToIcao[code.toUpperCase()] || code;
}

/**
 * Lista aeroportos brasileiros com status
 */
function getBrazilianAirports() {
  return [
    { iata: 'SDU', icao: 'SBRJ', name: 'Santos Dumont', city: 'Rio de Janeiro' },
    { iata: 'GIG', icao: 'SBGL', name: 'Galeão - Tom Jobim', city: 'Rio de Janeiro' },
    { iata: 'CGH', icao: 'SBSP', name: 'Congonhas', city: 'São Paulo' },
    { iata: 'GRU', icao: 'SBGR', name: 'Guarulhos', city: 'São Paulo' },
    { iata: 'BSB', icao: 'SBBR', name: 'Juscelino Kubitschek', city: 'Brasília' },
    { iata: 'CNF', icao: 'SBCF', name: 'Confins', city: 'Belo Horizonte' },
    { iata: 'SSA', icao: 'SBSV', name: 'Deputado Luís Eduardo Magalhães', city: 'Salvador' },
    { iata: 'REC', icao: 'SBRF', name: 'Guararapes', city: 'Recife' },
    { iata: 'FOR', icao: 'SBFZ', name: 'Pinto Martins', city: 'Fortaleza' },
    { iata: 'POA', icao: 'SBPA', name: 'Salgado Filho', city: 'Porto Alegre' },
  ];
}

module.exports = {
  getFlightInfo,
  getAirportArrivals,
  getAircraftHistory,
  findInboundFlight,
  getBrazilianAirports,
  convertToICAO
};
