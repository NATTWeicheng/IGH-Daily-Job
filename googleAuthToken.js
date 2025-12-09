const crypto = require('crypto');
require('dotenv').config();
const SECRET_KEY = process.env.GOOGLE_AUTH_CODE

function base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    base32 = base32.toUpperCase().replace(/=+$/, '');
    let bits = 0, value = 0, output = [];
    
    for (let i = 0; i < base32.length; i++) {
        value = (value << 5) | alphabet.indexOf(base32[i]);
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

function getGoogleAuthCode() {
    const key = base32Decode(SECRET_KEY);
    const counter = Math.floor(Date.now() / 30000);
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    
    const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1000000;
    
    const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    
    return {
        code: code.toString().padStart(6, '0'),
        secondsRemaining: secondsRemaining
    };
}

module.exports = { getGoogleAuthCode };