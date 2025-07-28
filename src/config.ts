interface Config {
  // Add your config properties here
  collectorHost: {
    host: string
    port: number
    reconnectDelay: number
    maxReconnectAttempts: number
  }
  port: number
  environment: string
}

const config: Config = {
  collectorHost: {
    host: 'localhost',
    port: 4444,
    reconnectDelay: 3000,
    maxReconnectAttempts: 10,
  },
  port: 4701,
  environment: 'development',
}

export { config }
