'use strict'

const BaseError = require('extensible-error')
const { codes } = require('../utils/ilp-errors')

class ReceiverRejectionError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F00_BAD_REQUEST
  }
}

module.exports = ReceiverRejectionError
