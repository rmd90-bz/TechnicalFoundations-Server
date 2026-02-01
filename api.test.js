const app = require('./index.js')
const supertest = require('supertest')
const request = supertest(app)

test('testing if jest works', () => {
    expect(1).toBe(1)
})

test('Testing root endpoint', async () => {
    const res = await request.get('/')
    const message = res.body.message
    expect(message).toBe('hi!!')
})


test('Testing recommend endpoint', async () => {
    const res = await request.get('/recommend').query({'type':'fruits'})
    const message = res.body.recommendation
    expect(message).toBe('Apple')
})

// ============================================
// FLIGHT TRACKING TESTS
// ============================================

test('GET /airports returns list of Brazilian airports', async () => {
    const res = await request.get('/airports')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    // Verifica que SDU está na lista
    const sdu = res.body.find(a => a.iata === 'SDU')
    expect(sdu).toBeDefined()
    expect(sdu.icao).toBe('SBRJ')
    expect(sdu.city).toBe('Rio de Janeiro')
})

test('GET /flights/:flightNumber returns flight info structure', async () => {
    const res = await request.get('/flights/G31145')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('flightNumber')
})

test('GET /flights/:flightNumber returns error for invalid flight number', async () => {
    const res = await request.get('/flights/AB')
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
})

test('GET /flights/:flightNumber/inbound returns inbound info structure', async () => {
    const res = await request.get('/flights/G31145/inbound').query({ airport: 'SDU' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('flightNumber')
    expect(res.body).toHaveProperty('departureAirport')
})

test('GET /airports/:code/arrivals returns arrivals structure', async () => {
    const res = await request.get('/airports/SDU/arrivals').query({ hours: 2 })
    // Pode ser 200 ou 404 dependendo da disponibilidade da API
    expect([200, 404]).toContain(res.status)
    if (res.status === 200) {
        expect(res.body).toHaveProperty('airport')
        expect(res.body).toHaveProperty('arrivals')
    }
})

test('GET /aircraft/:icao24/history returns error for invalid icao24', async () => {
    const res = await request.get('/aircraft/abc/history')
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
})