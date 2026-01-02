const crypto = require('crypto');

function base32Decode(base32) {
    if (!base32 || typeof base32 !== 'string') {
        throw new Error(
            'Invalid Base32 secret passed to getGoogleAuthCode()'
        );
    }

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    // Remove spaces and make uppercase
    base32 = base32.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');

    let bits = 0;
    let value = 0;
    const output = [];

    for (let i = 0; i < base32.length; i++) {
        const idx = alphabet.indexOf(base32[i]);
        if (idx === -1) {
            throw new Error(`Invalid Base32 character: ${base32[i]}`);
        }

        value = (value << 5) | idx;
        bits += 5;

        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }

    return Buffer.from(output);
}

function getGoogleAuthCode(secret) {
    if (!secret) {
        throw new Error(
            'TOTP secret is missing. Call getGoogleAuthCode(secret)'
        );
    }

    const key = base32Decode(secret);

    // Time step is 30 seconds
    const epoch = Math.floor(Date.now() / 1000);
    const timeCounter = Math.floor(epoch / 30);
    
    // Create 8-byte buffer for counter (big-endian)
    const buffer = Buffer.alloc(8);
    let tempCounter = timeCounter;
    for (let i = 0; i < 8; i++) {
        buffer[7 - i] = tempCounter & 0xff;
        tempCounter = tempCounter >> 8;
    }

    const hmac = crypto
        .createHmac('sha1', key)
        .update(buffer)
        .digest();

    const offset = hmac[hmac.length - 1] & 0x0f;

    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    
    const code = binary % 1000000;

    const secondsRemaining = 30 - (epoch % 30);

    return {
        code: code.toString().padStart(6, '0'),
        secondsRemaining
    };
}

module.exports = {
    getGoogleAuthCode
};