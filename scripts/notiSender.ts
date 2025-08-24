#!/usr/bin/env ts-node

import admin from 'firebase-admin'
import * as apn from 'node-apn'
import path from 'path'

// ---------- CONFIG ----------
// Path to your Firebase service account JSON
const FIREBASE_SERVICE_ACCOUNT = path.resolve(__dirname, '../auth/service-account.json')

const VOIP_KEY_PATH = './auth/AuthKey_XXX.p8' // your downloaded Push Notification  .p8 file
const VOIP_KEY_ID = 'XXX' // Key ID from Apple Developer
const VOIP_TEAM_ID = 'XXX' // Team ID from Apple Developer
const VOIP_BUNDLE_ID = 'XXX' // App bundle ID for VoIP
const VOIP_PRODUCTION = false // set to true for production

// Example usage:
// # Firebase push
// ts-node notiSender.ts <fcmToken> push "Test Title" "Test Body"

// # Firebase Call push
// ts-node notiSender.ts <fcmToken> call "Test Caller"

// # VoIP push
// ts-node auth/notiSender.ts <voipToken> voip "Incoming Call" "Test call from server"

// Initialize Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(FIREBASE_SERVICE_ACCOUNT)),
  })
}

async function sendPush(fcmToken: string, title: string, body: string) {
  const message = {
    token: fcmToken,
    notification: { title, body },
    data: { sentAt: new Date().toISOString() },
    android: { priority: 'high' as const },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: { alert: { title, body }, sound: 'default' },
      },
    },
  }
  return admin.messaging().send(message)
}

async function sendCall(fcmToken: string, callerName: string) {
  const callId = `call_${Date.now()}`
  const message = {
    token: fcmToken,
    data: {
      type: 'incoming_call',
      callId,
      callerName,
      callType: 'audio',
      sentAt: new Date().toISOString(),
    },
    android: {
      priority: 'high' as const,
    },
    apns: {
      headers: { 'apns-push-type': 'voip', 'apns-priority': '10' },
      payload: {
        aps: {
          'content-available': 1,
        },
        callId,
        callerName,
      },
    },
  }
  return admin.messaging().send(message)
}

async function sendVoip(voipToken: string, title: string, body: string) {
  const provider = new apn.Provider({
    token: { key: VOIP_KEY_PATH, keyId: VOIP_KEY_ID, teamId: VOIP_TEAM_ID },
    production: VOIP_PRODUCTION,
  })

  const note = new apn.Notification()
  note.topic = VOIP_BUNDLE_ID
  note.pushType = 'voip'
  note.payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      'content-available': 1,
    },
    callId: `call_${Date.now()}`,
    callerName: 'Liberdus',
    callType: 'audio',
  }
  note.expiry = Math.floor(Date.now() / 1000) + 3600

  const result = await provider.send(note, voipToken)
  provider.shutdown()
  return result
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.error('❌ Usage: ts-node noti-sender.ts <token> <push|call|voip> [title|callerName] [body]')
    process.exit(1)
  }

  const token = args[0]
  const type = args[1] as 'push' | 'call' | 'voip'
  const title = args[2] || '🔥 Test Notification'
  const body = args[3] || 'This is a standalone test notification'

  console.log(`📤 Sending ${type.toUpperCase()} notification...`)

  try {
    if (type === 'push') {
      const res = await sendPush(token, title, body)
      console.log('✅ Push sent:', res)
    } else if (type === 'call') {
      const res = await sendCall(token, title)
      console.log('✅ Call sent:', res)
    } else if (type === 'voip') {
      const res = await sendVoip(token, title, body)
      console.log('✅ VoIP sent:', res)
    } else {
      console.error('❌ Invalid type, use push | call | voip')
    }
  } catch (err) {
    console.error('❌ Error sending notification:', err)
  }
}

main()
