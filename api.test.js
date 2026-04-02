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

// Flight status tracker tests
test('Flight status returns 400 when no flight param provided', async () => {
    const res = await request.get('/flight-status')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing required query parameter/)
})

test('Flight status returns 400 for invalid flight format', async () => {
    const res = await request.get('/flight-status').query({ flight: '123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid flight format/)
})

test('Flight status returns known flight G3 1046', async () => {
    const res = await request.get('/flight-status').query({ flight: 'G31046' })
    expect(res.status).toBe(200)
    expect(res.body.airline).toBe('GOL')
    expect(res.body.flight).toBe('G3 1046')
    expect(res.body.departure.iata).toBe('CGH')
    expect(res.body.arrival.iata).toBe('SDU')
    expect(res.body.source).toBe('static_schedule')
    expect(res.body.checkUrls).toBeDefined()
})

test('Flight status handles dash format G3-1046', async () => {
    const res = await request.get('/flight-status').query({ flight: 'G3-1046' })
    expect(res.status).toBe(200)
    expect(res.body.airline).toBe('GOL')
})

test('Flight status returns 404 for unknown flight', async () => {
    const res = await request.get('/flight-status').query({ flight: 'XX9999' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/)
    expect(res.body.checkUrls).toBeDefined()
})