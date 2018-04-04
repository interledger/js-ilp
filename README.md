<h1 align="center">
  <a href="https://interledger.org"><img src="ilp_logo.png" width="150"></a>
  <br>
  ILP
</h1>

<h4 align="center">
The Javascript client library for <a href="https://interledger.org">Interledger</a>
</h4>

<br>

[![npm][npm-image]][npm-url] [![standard][standard-image]][standard-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url] [![snyk][snyk-image]][snyk-url]

[npm-image]: https://img.shields.io/npm/v/ilp.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp
[standard-image]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat
[standard-url]: http://standardjs.com/
[circle-image]: https://img.shields.io/circleci/project/interledgerjs/ilp/master.svg?style=flat
[circle-url]: https://circleci.com/gh/interledgerjs/ilp
[codecov-image]: https://img.shields.io/codecov/c/github/interledgerjs/ilp.svg?style=flat
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp
[snyk-image]: https://snyk.io/test/npm/ilp/badge.svg
[snyk-url]: https://snyk.io/test/npm/ilp

#### The ILP module includes:

* [Loopback Transport (LT)](https://github.com/interledger/rfcs/pull/416), a very basic and simplistic ILPv4-based transport layer protocol.

* [Simple Payment Setup Protocol Version 1 (SPSPv1)](#simple-payment-setup-protocol-version-1-spspv1), a higher level interface for sending ILP payments, which requires the receiver to have an SPSP server.
* [Pre-Shared Key Version 1 (PSKv1)](#pre-shared-key-version-1-pskv1-transport-protocol) Transport Protocol, a non-interactive protocol in which the sender creates the payment details and uses a shared secret to generate the conditions
* [Interledger Payment Request Version 2 (IPRv2)](#interledger-payment-request-version-2-iprv2-transport-protocol) Transport Protocol, an interactive protocol in which the receiver specifies the payment details, including the condition
* Interledger Quoting and the ability to send through multiple ledger types using [Ledger Plugins](https://github.com/interledgerjs?utf8=✓&q=ilp-plugin)

## Installation

`npm install --save ilp ilp-plugin

*Note that [ledger plugins](https://www.npmjs.com/search?q=ilp-plugin) must be installed alongside this module.*

## [Loopback Transport (LT)](https://github.com/interledger/rfcs/pull/416)

```js
const PluginBtp = require('ilp-plugin-btp')
const ILP = require('.')

;(async function test () {
  const pluginOut = new PluginBtp({ server: 'btp+wss://:plugin1@amundsen.ilpdemo.org:1810/' })
  const pluginIn = new PluginBtp({ server: 'btp+wss://:plugin2@amundsen.ilpdemo.org:1810/' })
  await pluginOut.connect()
  await pluginIn.connect()
  const loop = await ILP.LT.createLoop({ pluginOut, pluginIn })
  const result = await loop.pay({
    sourceAmount: '10',
    expiresAt: new Date(new Date().getTime() + 10000),
    loopbackHandler: (destinationAmount) => {
      console.log({ destinationAmount })
      return true
    }
  })
  console.log({ result })
  await pluginOut.disconnect()
  await pluginIn.disconnect()
})()
```

## [Simple Payment Setup Protocol Version 1 (SPSPv1)](https://github.com/interledger/rfcs/blob/master/0009-simple-payment-setup-protocol/0009-simple-payment-setup-protocol.md)

If you are sending to an SPSPv1 receiver with a `user@example.com` identifier, the SPSPv1 module
provides a high-level interface:

```js
'use strict'

const SPSP = require('ilp').SPSP
const Plugin = require('ilp-plugin')

const plugin = new Plugin()

;(async function () {
  await plugin.connect()
  console.log('plugin connected')

  const payment = await SPSP.quote(plugin, {
    receiver: 'bob@blue.ilpdemo.org',
    sourceAmount: '1'
  })

  console.log('got SPSP payment details:', payment)

  // we can attach an arbitrary JSON object to the payment if we want it
  // to be sent to the receiver.
  payment.memo = { message: 'hello!' }

  await SPSP.sendPayment(plugin, payment)
  console.log('receiver claimed funds!')
})()
```

## [Pre-Shared Key Version 1 (PSKv1) Transport Protocol](https://github.com/interledger/rfcs/blob/master/0016-pre-shared-key/0016-pre-shared-key.md)

This is a non-interactive protocol in which the sender chooses the payment
amount and generates the condition without communicating with the recipient.

PSK uses a secret shared between the sender and receiver. The key can be
generated by the receiver and retrieved by the sender using a higher-level
protocol such as SPSP, or any other method. In the example below,
the pre-shared key is simply passed to the sender inside javascript.

When sending a payment using PSK, the sender generates an HMAC key from the
PSK, and HMACs the payment to get the fulfillment, which is hashed to get the
condition. The sender also encrypts their optional extra data using AES. On
receipt of the payment, the receiver decrypts the extra data, and HMACs the
payment to get the fulfillment.

In order to receive payments using PSK, the receiver must also register a
`reviewPayment` handler. `reviewPayment` is a callback that returns either a
promise or a value, and will prevent the receiver from fulfilling a payment if
it throws an error. This callback is important, because it stops the receiver
from getting unwanted funds.

### PSK Sending and Receiving Example

```js
'use strict'

const uuid = require('uuid')
const ILP = require('ilp')
const PluginBtp = require('ilp-plugin-btp')

const sender = new PluginBtp({
  server: 'btp+wss://:alice@btp.connector.example'
})

const receiver = new PluginBtp({
  server: 'btp+wss://:bob@btp.connector.example'
})

;(async function () {
  // --- RECEIVER START ---
  await receiver.connect()

  const receiverSecret = Buffer.from('secret_seed')

  const listener = await ILP.PSK.listen(receiver, { receiverSecret }, (params) => {
    console.log('got transfer:', params.transfer)

    console.log('fulfilling.')
    return params.fulfill()
  })

  console.log('receiver connected')

  // Note the user of this module must implement the method for
  // communicating sharedSecret and destinationAccount from the recipient
  // to the sender
  const { sharedSecret, destinationAccount } = listener.generateParams()
  // --- RECEIVER END ---

  // --- SENDER START ---
  // the sender can generate these, via the sharedSecret and destinationAccount
  // given to them by the receiver.
  const { packet, condition } = ILP.PSK.createPacketAndCondition({
    sharedSecret,
    destinationAccount,
    destinationAmount: '10', // denominated in the ledger's base unit
  })

  const quote = await ILP.ILQP.quoteByPacket(sender, packet)
  console.log('got quote:', quote)

  await sender.sendTransfer({
    id: uuid(),
    to: quote.connectorAccount,
    amount: quote.sourceAmount,
    expiresAt: quote.expiresAt,
    executionCondition: condition,
    ilp: packet
  })

  sender.on('outgoing_fulfill', (transfer, fulfillment) => {
    console.log(transfer.id, 'was fulfilled with', fulfillment)
    stopListening()
  })
  // --- SENDER END ---
})()
```

## [Interledger Payment Request Version 2 (IPRv2) Transport Protocol](https://github.com/interledger/rfcs/blob/master/0011-interledger-payment-request/0011-interledger-payment-request.md)

This protocol uses recipient-generated Interledger Payment Requests, which include the condition for the payment. This means that the recipient must first generate a payment request, which the sender then fulfills.

This library handles the generation of payment requests, but **not the communication of the request details from the recipient to the sender**. In some cases, the sender and receiver might be HTTP servers, in which case HTTP would be used. In other cases, they might be using a different medium of communication.

### IPR Sending and Receiving Example

```js
'use strict'

const uuid = require('uuid')
const ILP = require('ilp')
const PluginBtp = require('ilp-plugin-btp')

const sender = new PluginBtp({
  server: 'btp+wss://:alice@btp.connector.example'
})

const receiver = new PluginBtp({
  server: 'btp+wss://:bob@btp.connector.example'
})

;(async function () {
  const stopListening = await ILP.IPR.listen(receiver, {
    receiverSecret: Buffer.from('secret', 'utf8')
  }, async function ({ transfer, fulfill }) {
    console.log('got transfer:', transfer)

    console.log('claiming incoming funds...')
    await fulfill()
    console.log('funds received!')
  })

  // `ipr` is a buffer with the encoded IPR
  const ipr = ILP.IPR.createIPR({
    receiverSecret: Buffer.from('secret', 'utf8'),
    destinationAccount: receiver.getAccount(),
    // denominated in the ledger's base unit
    destinationAmount: '10',
  })

  // Note the user of this module must implement the method for communicating
  // packet and condition from the recipient to the sender.

  // In practice, The rest of this example would happen on the sender's side.

  const { packet, condition } = ILP.IPR.decodeIPR(ipr)
  const quote = await ILP.ILQP.quoteByPacket(sender, packet)
  console.log('got quote:', quote)

  await sender.sendTransfer({
    id: uuid(),
    to: quote.connectorAccount,
    amount: quote.sourceAmount,
    expiresAt: quote.expiresAt,
    executionCondition: condition,
    ilp: packet
  })

  sender.on('outgoing_fulfill', (transfer, fulfillment) => {
    console.log(transfer.id, 'was fulfilled with', fulfillment)
  })
})()
```

## API Reference

<a name="module_SPSP..query"></a>

### SPSP~query ⇒ <code>Promise.&lt;SpspResponse&gt;</code>
Query an SPSP endpoint and get SPSP details

**Kind**: inner constant of <code>[SPSP](#module_SPSP)</code>
**Returns**: <code>Promise.&lt;SpspResponse&gt;</code> - SPSP SPSP response from server

| Param | Type | Description |
| --- | --- | --- |
| receiver | <code>String</code> | webfinger account identifier (eg. 'alice@example.com') or URL to SPSP endpoint. |

<a name="module_SPSP..validateSPSPResponse"></a>

### SPSP~validateSPSPResponse(SPSP)
Validate a server's SPSP response, and throw an error if it's wrong.

**Kind**: inner method of <code>[SPSP](#module_SPSP)</code>

| Param | Type | Description |
| --- | --- | --- |
| SPSP | <code>Promise.&lt;SpspResponse&gt;</code> | SPSP response from server |

<a name="module_SPSP..quote"></a>

### SPSP~quote(plugin, params) ⇒ <code>Promise.&lt;SpspPayment&gt;</code>
Quote to an SPSP receiver

**Kind**: inner method of <code>[SPSP](#module_SPSP)</code>
**Returns**: <code>Promise.&lt;SpspPayment&gt;</code> - SPSP payment object to be sent.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| plugin | <code>Object</code> |  | Ledger plugin used for quoting. |
| params | <code>Object</code> |  | Quote parameters |
| params.receiver | <code>String</code> |  | webfinger account identifier (eg. 'alice@example.com') or URL to SPSP endpoint. |
| [params.sourceAmount] | <code>String</code> |  | source amount to quote. This is a decimal, NOT an integer. It will be shifted by the sending ledger's scale to get the integer amount. |
| [params.destinationAmount] | <code>String</code> |  | destination amount to quote. This is a decimal, NOT an integer. It will be shifted by the receiving ledger's scale to get the integer amount. |
| [params.id] | <code>String</code> | <code>uuid()</code> | id to use for payment. sending a payment with the same id twice will be idempotent. If left unspecified, the id will be generated randomly. |
| [params.timeout] | <code>Number</code> | <code>5000</code> | how long to wait for a quote response (ms). |
| [params.spspResponse] | <code>SpspResponse</code> | <code>SPSP.query(params.receiver)</code> | SPSP response. The receiver endpoint will be queried automatically if this isn't supplied. |

<a name="module_SPSP..sendPayment"></a>

### SPSP~sendPayment(plugin, payment) ⇒ <code>Promise.&lt;Object&gt;</code> &#124; <code>String</code>
Quote to an SPSP receiver

**Kind**: inner method of <code>[SPSP](#module_SPSP)</code>
**Returns**: <code>Promise.&lt;Object&gt;</code> - result The result of the payment.<code>String</code> - result.fulfillment The fulfillment of the payment.

| Param | Type | Description |
| --- | --- | --- |
| plugin | <code>Object</code> | Ledger plugin used for quoting. |
| payment | <code>SpspPayment</code> | SPSP Payment returned from SPSP.quote. |

<a name="module_SPSP..SpspPayment"></a>

### SPSP~SpspPayment : <code>Object</code>
/**
Parameters for an SPSP payment

**Kind**: inner typedef of <code>[SPSP](#module_SPSP)</code>
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| id | <code>id</code> |  | UUID to ensure idempotence between calls to sendPayment |
| source_amount | <code>string</code> |  | Decimal string, representing the amount that will be paid on the sender's ledger. |
| destination_amount | <code>string</code> |  | Decimal string, representing the amount that the receiver will be credited on their ledger. |
| destination_account | <code>string</code> |  | Receiver's ILP address. |
| spsp | <code>string</code> |  | SPSP response object, containing details to contruct transfers. |
| publicHeaders | <code>Object</code> | <code>{}</code> | public headers for PSK data. The key-value pairs represent header names and values. |
| headers | <code>Object</code> | <code>{}</code> | headers for PSK data. The key-value pairs represent header names and values. |
| memo | <code>Object</code> | <code>{}</code> | arbitrary JSON object for additional data. |

<a name="module_SPSP..SpspResponse"></a>

### SPSP~SpspResponse : <code>Object</code>
SPSP query response

**Kind**: inner typedef of <code>[SPSP](#module_SPSP)</code>
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| destination_account | <code>string</code> | The ILP address which will receive payments. |
| shared_secret | <code>string</code> | Base64url encoded 16-byte shared secret for use in PSK. |
| maximum_destination_amount | <code>string</code> | Integer string representing the maximum that the receiver will be willing to accept. |
| minimum_destination_amount | <code>string</code> | Integer string representing the minimum that the receiver will be willing to accept. |
| ledger_info | <code>Object</code> | An object containing the receiver's ledger metadata. |
| ledger_info.currency_code | <code>string</code> | The currency code of the receiver's ledger. |
| ledger_info.currency_scale | <code>string</code> | The currency scale of the receiver's ledger. |
| receiver_info | <code>Object</code> | Additional information containing arbitrary fields. |


<a name="module_ILQP..quote"></a>

### ILQP~quote(plugin, query) ⇒ <code>Promise.&lt;Quote&gt;</code>
**Kind**: inner method of <code>[ILQP](#module_ILQP)</code>

| Param | Type | Description |
| --- | --- | --- |
| plugin | <code>Object</code> | The LedgerPlugin used to send quote request |
| query | <code>Object</code> |  |
| query.sourceAddress | <code>String</code> | Sender's address |
| query.destinationAddress | <code>String</code> | Recipient's address |
| [query.sourceAmount] | <code>String</code> | Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger. |
| [query.destinationAmount] | <code>String</code> | Either the sourceAmount or destinationAmount must be specified. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger. |
| [query.destinationExpiryDuration] | <code>String</code> &#124; <code>Number</code> | Number of seconds between when the destination transfer is proposed and when it expires. |


<a name="module_PSK..createPacketAndCondition"></a>

### PSK~createPacketAndCondition(params) ⇒ <code>Object</code>
Create a payment request using a Pre-Shared Key (PSK).

**Kind**: inner method of <code>[PSK](#module_PSK)</code>
**Returns**: <code>Object</code> - Payment request

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.destinationAmount | <code>String</code> |  | Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger. |
| params.destinationAccount | <code>String</code> |  | Target account's ILP address |
| params.sharedSecret | <code>String</code> |  | Shared secret for PSK protocol |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>none</code> | Expiry of request |
| [params.data] | <code>Buffer</code> | <code></code> | Additional data to include in the request |
| [params.headers] | <code>Object</code> | <code></code> | Additional headers for private PSK details. The key-value pairs represent header names and values. |
| [params.publicHeaders] | <code>Object</code> | <code></code> | Additional headers for public PSK details. The key-value pairs represent header names and values. |
| [params.disableEncryption] | <code>Boolean</code> | <code>false</code> | Turns off encryption of private memos and data |
| [params.minFulfillRetryWait] | <code>Number</code> | <code>250</code> | Minimum amount of time (in ms) to wait before retrying fulfillment |
| [params.maxFulfillRetryWait] | <code>Number</code> | <code>1000</code> | Maximum amount of time (in ms) to wait before retrying fulfillment |

<a name="module_PSK..generateParams"></a>

### PSK~generateParams(params) ⇒ <code>PskParams</code>
Generate shared secret for Pre-Shared Key (PSK) transport protocol.

**Kind**: inner method of <code>[PSK](#module_PSK)</code>

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | Parameters for creating PSK params |
| params.destinationAccount | <code>String</code> | The ILP address that will receive PSK payments |
| params.receiverSecret | <code>Buffer</code> | secret used to generate the shared secret and the extra segments of destinationAccount |

<a name="module_PSK..listen"></a>

### PSK~listen(plugin, params, callback) ⇒ <code>Object</code>
Listen on a plugin for incoming PSK payments, and auto-generate fulfillments.

**Kind**: inner method of <code>[PSK](#module_PSK)</code>
**Returns**: <code>Object</code> - Payment request

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| plugin | <code>Object</code> |  | Ledger plugin to listen on |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.sharedSecret | <code>Buffer</code> |  | Secret to generate fulfillments with |
| [params.allowOverPayment] | <code>Buffer</code> | <code>false</code> | Accept payments with higher amounts than expected |
| callback | <code>IncomingCallback</code> |  | Called after an incoming payment is validated. |

<a name="module_PSK..listenAll"></a>

### PSK~listenAll(factory, params, callback) ⇒ <code>Object</code>
Listen on a ILP plugin bells factory for incoming PSK payments, and auto-generate fulfillments.

**Kind**: inner method of <code>[PSK](#module_PSK)</code>
**Returns**: <code>Object</code> - Payment request

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| factory | <code>Object</code> |  | Plugin bells factory to listen on |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.receiverSecret | <code>Buffer</code> |  | secret used to generate the shared secret and the extra segments of destinationAccount |
| [params.allowOverPayment] | <code>Boolean</code> | <code>false</code> | Accept payments with higher amounts than expected |
| callback | <code>IncomingCallback</code> |  | Called after an incoming payment is validated. |

<a name="module_PSK..IncomingCallback"></a>

### PSK~IncomingCallback : <code>function</code>
**Kind**: inner typedef of <code>[PSK](#module_PSK)</code>

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.transfer | <code>Object</code> | Raw transfer object emitted by plugin |
| params.data | <code>Object</code> | Decrypted data parsed from transfer |
| params.destinationAccount | <code>String</code> | destinationAccount parsed from ILP packet |
| params.destinationAmount | <code>String</code> | destinationAmount parsed from ILP packet |
| params.fulfill | <code>function</code> | async function that fulfills the transfer when it is called |


<a name="module_IPR..createPacketAndCondition"></a>

### IPR~createPacketAndCondition(params) ⇒ <code>Object</code>
Create a packet and condition

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Object</code> - Packet and condition for use in the IPR protocol.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.destinationAmount | <code>String</code> |  | Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger. |
| params.destinationAccount | <code>String</code> |  | Target account's ILP address |
| params.receiverSecret | <code>Buffer</code> |  | Secret for generating IPR packets |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>60 seconds from now</code> | Expiry of request |
| [params.data] | <code>Buffer</code> | <code></code> | Additional data to include in the request |
| [params.headers] | <code>Object</code> | <code></code> | Additional headers for private details. The key-value pairs represent header names and values. |
| [params.publicHeaders] | <code>Object</code> | <code></code> | Additional headers for public details. The key-value pairs represent header names and values. |
| [params.disableEncryption] | <code>Boolean</code> | <code>false</code> | Turns off encryption of private memos and data |
| [params.minFulfillRetryWait] | <code>Number</code> | <code>250</code> | Minimum amount of time (in ms) to wait before retrying fulfillment |
| [params.maxFulfillRetryWait] | <code>Number</code> | <code>1000</code> | Maximum amount of time (in ms) to wait before retrying fulfillment |

<a name="module_IPR..encodeIPR"></a>

### IPR~encodeIPR(params) ⇒ <code>Buffer</code>
Create an encoded IPR for use in the IPR transport protocol

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Buffer</code> - encoded IPR buffer

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> | Parameters for encoding IPR |
| params.packet | <code>String</code> | ILP packet of this IPR |
| params.condition | <code>String</code> | condition of this IPR |

<a name="module_IPR..decodeIPR"></a>

### IPR~decodeIPR(ipr) ⇒ <code>Object</code>
Decode an IPR buffer for use in the IPR transport protocol

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Object</code> - Decoded IPR parameters, containing 'packet' and 'condition' as base64url strings.

| Param | Type | Description |
| --- | --- | --- |
| ipr | <code>Buffer</code> | encoded IPR buffer |

<a name="module_IPR..createIPR"></a>

### IPR~createIPR(params) ⇒ <code>Buffer</code>
Create a payment request for use in the IPR transport protocol.

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Buffer</code> - encoded IPR buffer for use in the IPR protocol

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.destinationAmount | <code>String</code> |  | Amount that should arrive in the recipient's account. This value is a string representation of an integer, expressed in the lowest indivisible unit supported by the ledger. |
| params.destinationAccount | <code>String</code> |  | Target account's ILP address |
| params.receiverSecret | <code>Buffer</code> |  | Secret for generating IPR packets |
| [params.id] | <code>String</code> | <code>uuid.v4()</code> | Unique ID for the request (used to ensure conditions are unique per request) |
| [params.expiresAt] | <code>String</code> | <code>60 seconds from now</code> | Expiry of request |
| [params.data] | <code>Buffer</code> | <code></code> | Additional data to include in the request |
| [params.headers] | <code>Object</code> | <code></code> | Additional headers for private details. The key-value pairs represent header names and values. |
| [params.publicHeaders] | <code>Object</code> | <code></code> | Additional headers for public details. The key-value pairs represent header names and values. |
| [params.disableEncryption] | <code>Object</code> | <code>false</code> | Turns off encryption of private memos and data |

<a name="module_IPR..listen"></a>

### IPR~listen(plugin, params, callback) ⇒ <code>Object</code>
Listen on a plugin for incoming IPR payments, and auto-generate fulfillments.

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Object</code> - Payment request

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| plugin | <code>Object</code> |  | Ledger plugin to listen on |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.secret | <code>Buffer</code> |  | Secret to generate fulfillments with |
| [params.allowOverPayment] | <code>Buffer</code> | <code>false</code> | Accept payments with higher amounts than expected |
| callback | <code>IncomingCallback</code> |  | Called after an incoming payment is validated. |

<a name="module_IPR..listenAll"></a>

### IPR~listenAll(factory, params, callback) ⇒ <code>Object</code>
Listen on a ILP plugin bells factory for incoming IPR payments, and auto-generate fulfillments.

**Kind**: inner method of <code>[IPR](#module_IPR)</code>
**Returns**: <code>Object</code> - Payment request

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| factory | <code>Object</code> |  | Plugin bells factory to listen on |
| params | <code>Object</code> |  | Parameters for creating payment request |
| params.generateReceiverSecret | <code>function</code> |  | function that returns receiver secret for a given username |
| [params.allowOverPayment] | <code>Boolean</code> | <code>false</code> | Accept payments with higher amounts than expected |
| callback | <code>IncomingCallback</code> |  | Called after an incoming payment is validated. |

<a name="module_IPR..IncomingCallback"></a>

### IPR~IncomingCallback : <code>function</code>
**Kind**: inner typedef of <code>[IPR](#module_IPR)</code>

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.transfer | <code>Object</code> | Raw transfer object emitted by plugin |
| params.data | <code>Object</code> | Decrypted data parsed from transfer |
| params.destinationAccount | <code>String</code> | destinationAccount parsed from ILP packet |
| params.destinationAmount | <code>String</code> | destinationAmount parsed from ILP packet |
| params.fulfill | <code>function</code> | async function that fulfills the transfer when it is called |
