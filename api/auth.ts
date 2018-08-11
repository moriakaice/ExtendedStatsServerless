import {Callback} from "aws-lambda";
import jwt = require('jsonwebtoken');
import {findOrCreateUser, retrieveAllData} from "./users";
import {Decoded, PersonalData, UserData} from "./security-interfaces";
// import jwksClient = require('jwks-rsa');
// import {Jwk} from "jwks-rsa";
//
// const client = jwksClient({
//     jwksUri: 'https://drfriendless.au.auth0.com/.well-known/jwks.json'
// });

// this is the contents of a public file
const jwks = {
    "keys":[
        {
            "alg":"RS256",
            "kty":"RSA",
            "use":"sig",
            "x5c":["MIIDDTCCAfWgAwIBAgIJIMF/QrbM4dGoMA0GCSqGSIb3DQEBCwUAMCQxIjAgBgNVBAMTGWRyZnJpZW5kbGVzcy5hdS5hdXRoMC5jb20wHhcNMTgwNzA0MDY1NDMxWhcNMzIwMzEyMDY1NDMxWjAkMSIwIAYDVQQDExlkcmZyaWVuZGxlc3MuYXUuYXV0aDAuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA63saLsBd4ssvVgYMRDpvO5r0JoIMSLlligYFb7Rr0S0hXYa8hYJjtKjxvzhovNoQGbwE2wpkJ26TtKIt+fzJjWKOL3m5918ya4rSavI4dR/sdJt78qAzYUTJ54bu6TFj7X0r3zl6uovnYi+YeGpno/0IFW3IXKCPNcrvNBQmxysqr6+hgHlUw0QnHwYUUrLYs6om2VzT1PAJBEijQFb70mX+OTBiO3NTzREKDcMYIOJi2y+2arMV923iiebd714TQBk7pVNq44VjA2gFS+eC2Ju7Wp8y3m40IN52NvvwORAhlPvDAL4r2zx8RGLfvuMJcYaRVv6YKAqT6PuIZP9ACQIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBQhk89ZTUB1316fmnqy1hoy20/4ZTAOBgNVHQ8BAf8EBAMCAoQwDQYJKoZIhvcNAQELBQADggEBAEgkMQh9XNg844naxUmCKIOUA9Z0ZY0lplWiIl1dbhdSmR0Zxe7r71y4weGiDd32G3MXhvJbrxwneXIP7aLWoP2zNsFgMAkd+7rBzkMmgWSAtUt54aNDYQl59kuqinWZDlM51pJx2vj8OShs3nMBV8iVPeBLrHHZQeRlW1Yl5dvPyQAbvYmlxFMDlmlBuB7prF964tWUC/f9r2eWEMEDDZW8V/iYxiqVhkdTbsM+s76n/dPNGh1RdgCp5owV8Ge9q2oS5wkIiumMNQ46odGK20ZlOJIpcc/fs13G03VR6W9r6hNaVeMCTysZstW+ylsNwY5cLt0gigL8ifj4Sd6nvkU="],"n":"63saLsBd4ssvVgYMRDpvO5r0JoIMSLlligYFb7Rr0S0hXYa8hYJjtKjxvzhovNoQGbwE2wpkJ26TtKIt-fzJjWKOL3m5918ya4rSavI4dR_sdJt78qAzYUTJ54bu6TFj7X0r3zl6uovnYi-YeGpno_0IFW3IXKCPNcrvNBQmxysqr6-hgHlUw0QnHwYUUrLYs6om2VzT1PAJBEijQFb70mX-OTBiO3NTzREKDcMYIOJi2y-2arMV923iiebd714TQBk7pVNq44VjA2gFS-eC2Ju7Wp8y3m40IN52NvvwORAhlPvDAL4r2zx8RGLfvuMJcYaRVv6YKAqT6PuIZP9ACQ",
            "e":"AQAB",
            "kid":"QzlGODM4Q0Y2NkE4RUM1QUZCREQzNkJFNTJDNUUxQkU2MUU5MDIzMg",
            "x5t":"QzlGODM4Q0Y2NkE4RUM1QUZCREQzNkJFNTJDNUUxQkU2MUU5MDIzMg"
        }
    ]
};

async function withAuthentication(event, callback: (Error?, Decoded?) => Promise<void>): Promise<void> {
    let token = event["headers"]["Authorization"] as string;
    if (token.slice(0, 7) === "Bearer ") {
        token = token.substring(7);
    } else {
        await callback(new Error("No Authorization header"));
    }
    const options = {
        algorithms: ["RS256"],
        issuer: ["https://drfriendless.au.auth0.com/"],
        audience: ["z7FL2jZnXI9C66WcmCMC7V1STnQbFuQl"] // this is the ID of the application in auth0
        // TODO check token is not expired
    };
    let decoded = null;
    try {
        jwt.verify(token, getKey, options, function (err, d) {
            if (err) {
                console.log(err);
                throw err;
            } else {
                console.log(d);
                decoded = d;
            }
        });
        await callback(undefined, decoded);
    } catch (err) {
        await callback(err);
    }
}

export async function authenticate(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    await withAuthentication(event, async (error, decoded) => {
        if (error) {
            console.log(error);
            callback(new Error("Computer says no."));
        } else {
            callback(undefined, await getUserData(decoded));
        }
    });
}

async function getUserData(decoded: Decoded): Promise<UserData> {
    const user = await findOrCreateUser(decoded.sub, decoded.nickname);
    return { jwt: decoded, username: user.getUsername(), first: user.isFirstLogin(), config: user.getConfig() };
}

async function getPersonalData(decoded: Decoded): Promise<PersonalData> {
    return { userData: await getUserData(decoded), allData: await retrieveAllData(decoded.sub) };
}

export async function personal(event, context, callback: Callback) {
    context.callbackWaitsForEmptyEventLoop = false;
    await withAuthentication(event, async (error, decoded) => {
        if (error) {
            console.log(error);
            callback(new Error("Computer says no."));
        } else {
            callback(undefined, await getPersonalData(decoded));
        }
    });
}

function getKey(header, callback) {
    // can't get out to the internet from inside the VPC
    // I'd rather do this the proper way, but I'm not sure how to solve that problem.
    if (header.kid === jwks.keys[0].kid) {
        const key = jwks.keys[0];
        const k = certToPEM(key.x5c[0]);
        callback(undefined, k);
    } else {
        callback(new Error("Unknown key"));
    }
    // client.getSigningKey(header.kid, function(err, key: Jwk) {
    //     if (err) {
    //         callback(err);
    //     } else {
    //         console.log("inner");
    //         console.log(key);
    //         const signingKey = key.publicKey || key.rsaPublicKey;
    //         console.log("signingKey");
    //         console.log(signingKey);
    //         callback(null, signingKey);
    //     }
    // });
}

// stolen from https://github.com/auth0/node-jwks-rsa/blob/master/src/utils.js
function certToPEM(cert) {
    cert = cert.match(/.{1,64}/g).join('\n');
    cert = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----\n`;
    return cert;
}
