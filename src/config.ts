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
  firebase: {
    serviceAccountPath: string
  }
  voip: {
    keyPath: string
    keyId: string
    teamId: string
    bundleId: string
    production: boolean
  }
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
  firebase: {
    serviceAccountPath: './auth/service-account.json',
  },
  voip: {
    keyPath: './auth/AuthKey_XXX.p8',
    keyId: 'XXX',
    teamId: 'XXX',
    bundleId: 'XXX',
    production: false,
  },
}

export { config }
