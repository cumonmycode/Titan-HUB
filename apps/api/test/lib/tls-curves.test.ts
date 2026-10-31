import assert from 'node:assert/strict'
import tls from 'node:tls'
import { describe, it } from 'node:test'
import { CLASSIC_ECDH_CURVES } from '../../src/lib/tlsCurves.js'

describe('кривые TLS для исходящих соединений', () => {
  it('процесс предлагает только классические кривые — без постквантового MLKEM', () => {
    assert.equal(tls.DEFAULT_ECDH_CURVE, CLASSIC_ECDH_CURVES)
    assert.doesNotMatch(tls.DEFAULT_ECDH_CURVE, /mlkem|kyber/i)
  })

  it('OpenSSL принимает этот список кривых', () => {
    assert.doesNotThrow(() => tls.createSecureContext())
  })
})
