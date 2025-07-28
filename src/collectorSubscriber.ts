import WebSocket from 'ws'
import { Utils as StringUtils } from '@shardus/types'

interface WebSocketMessage {
  event: string
  data: string
}

interface SubscriberConfig {
  host: string
  port: number
  reconnectDelay: number
  maxReconnectAttempts: number
  verbose: boolean
}

export class CollectorSubscriber {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private isReconnecting = false
  private config: SubscriberConfig
  private dataHandler: ((message: WebSocketMessage) => void) | null = null

  constructor(config: Partial<SubscriberConfig> = {}) {
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 4444,
      reconnectDelay: config.reconnectDelay || 5000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      verbose: config.verbose || config.verbose || false,
    }
  }

  public connect(): void {
    const url = `ws://${this.config.host}:${this.config.port}`

    if (this.config.verbose) {
      console.log(`Connecting to collector server at ${url}`)
    }

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('Connected to collector server')
      this.reconnectAttempts = 0
      this.isReconnecting = false
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      const message: WebSocketMessage = JSON.parse(data.toString())
      this.handleMessage(message)
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`Connection closed: ${code} - ${reason.toString()}`)
      this.ws = null
      this.attemptReconnect()
    })

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error)
      if (this.ws) {
        this.ws.close()
        this.isReconnecting = false
      }
    })
  }
  public onData(callback: (message: WebSocketMessage) => void): void {
    this.dataHandler = callback
  }

  private handleMessage(message: WebSocketMessage): void {
    if (this.config.verbose) {
      console.log('Received message:', message)
    }

    if (this.dataHandler) {
      this.dataHandler(message)
    }
  }

  private attemptReconnect(): void {
    if (this.isReconnecting || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached. Giving up.')
      }
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`)

    setTimeout(() => {
      this.connect()
    }, this.config.reconnectDelay)
  }

  public disconnect(): void {
    if (this.ws) {
      console.log('Shutting down subscriber...')
      this.ws.close()
      this.ws = null
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  public getConnectionState(): string {
    if (!this.ws) return 'DISCONNECTED'

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING'
      case WebSocket.OPEN:
        return 'OPEN'
      case WebSocket.CLOSING:
        return 'CLOSING'
      case WebSocket.CLOSED:
        return 'CLOSED'
      default:
        return 'UNKNOWN'
    }
  }
}

export default CollectorSubscriber
