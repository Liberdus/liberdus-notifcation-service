interface Config {
  // Add your config properties here
  collectorHost: {
    host: string
    port: number
  }
  port: number
  environment: string
}

const config: Config = {
  collectorHost: {
    host: 'localhost',
    port: 4444,
  },
  port: 4701,
  environment: 'development',
}

export { config }
