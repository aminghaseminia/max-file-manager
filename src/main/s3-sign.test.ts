import test from 'node:test'
import assert from 'node:assert/strict'
import {
  awsUriEncode,
  canonicalQueryString,
  encodeS3Path,
  EMPTY_SHA256,
  signV4,
  type SigV4Input
} from './s3-sign.ts'

const ACCESS = 'AKIAIOSFODNN7EXAMPLE'
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const NOW = new Date('2013-05-24T00:00:00.000Z')

type SignInput = Omit<SigV4Input, 'accessKey' | 'secretKey' | 'region' | 'now'>
const sign = (input: SignInput) =>
  signV4({ ...input, accessKey: ACCESS, secretKey: SECRET, region: 'us-east-1', now: NOW })

test('AWS vector: GET object with a Range header', () => {
  const r = sign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    headers: { range: 'bytes=0-9' }
  })
  assert.equal(r.contentSha256, EMPTY_SHA256)
  assert.equal(
    r.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  )
})

test('AWS vector: GET bucket lifecycle (empty query value is part of the canonical query)', () => {
  const r = sign({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/', query: { lifecycle: '' } })
  assert.equal(r.queryString, 'lifecycle=')
  assert.equal(
    r.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
      'Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543'
  )
})

test('AWS vector: list objects with max-keys and prefix', () => {
  const r = sign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/',
    query: { 'max-keys': '2', prefix: 'J' }
  })
  assert.equal(r.queryString, 'max-keys=2&prefix=J')
  assert.equal(
    r.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'
  )
})

test('AWS vector: PUT object with a signed payload', () => {
  const payload = 'Welcome to Amazon S3.'
  const hash = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072'
  const r = sign({
    method: 'PUT',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test%24file.text',
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payloadHash: hash
  })
  assert.equal(r.contentSha256, hash)
  assert.equal(
    r.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
      'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'
  )
  assert.equal(payload.length > 0, true)
})

test('session tokens are signed and sent', () => {
  const r = sign({ method: 'GET', host: 'bucket.s3.us-west-2.amazonaws.com', path: '/x', sessionToken: 'token-123' })
  assert.match(r.signedHeaders, /x-amz-security-token/)
  assert.equal(r.headers['x-amz-security-token'], 'token-123')
  assert.equal(r.headers.Authorization, r.authorization)
  assert.equal(r.headers.host, 'bucket.s3.us-west-2.amazonaws.com')
})

test('URI encoding follows the AWS unreserved set and keeps slashes only when asked', () => {
  assert.equal(awsUriEncode('a b'), 'a%20b')
  assert.equal(awsUriEncode('/a/b'), '%2Fa%2Fb')
  assert.equal(awsUriEncode('/a/b', false), '/a/b')
  assert.equal(awsUriEncode("a!'()*b"), 'a%21%27%28%29%2Ab')
  assert.equal(awsUriEncode('ü'), '%C3%BC')
  assert.equal(encodeS3Path('photos/ünïcode file (1).jpg'), 'photos/%C3%BCn%C3%AFcode%20file%20%281%29.jpg')
  assert.equal(encodeS3Path('a/../b'), 'a/../b')
})

test('query values are sorted by encoded key and value', () => {
  assert.equal(
    canonicalQueryString({ prefix: 'a b', delimiter: '/', 'max-keys': 1000, 'continuation-token': undefined }),
    'delimiter=%2F&max-keys=1000&prefix=a%20b'
  )
  assert.equal(canonicalQueryString({ b: '2', a: '1' }), 'a=1&b=2')
})

test('headers are lowercased, trimmed and sorted, and authorization is never signed', () => {
  const r = sign({
    method: 'GET',
    host: 'example.com',
    path: '/',
    headers: { 'Content-Type': '  text/plain  ', Authorization: 'should not be signed' }
  })
  assert.equal(r.signedHeaders, 'content-type;host;x-amz-content-sha256;x-amz-date')
  assert.equal(r.authorization.includes('should not be signed'), false)
})
