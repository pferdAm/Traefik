import argon2 from "argon2";
import {COLLECTIONS, getDocument, getUsersList} from './database.js'
import services from '/usr/src/services.js'
import {serialize, sign, parse, unsign} from "@fastify/cookie";

const base = '$argon2id$v=19$m=65536,t=3,p=4$'

export const defaultErrorCode = 401
export const SERVICE_AUTH_KEY = 'serviceAuth'

export async function authenticate(headers) {
    const {referer,
        authorization: authHeader,
        'x-forwarded-host': host,
        'x-forwarded-uri': uri,
        'x-service': serviceCookie
    } = headers
    const isServiceAuth = !!serviceCookie
    const isWs = headers['sec-fetch-mode'] === 'websocket'
    const isAssetUri = new RegExp(`/assets/index-.*\.(js|css)`).test(uri) || uri.startsWith('/favicon/') || /\/logo\.(jpg|png|webp)/.test(uri)
    const authReturn = {
        code:  isServiceAuth ? 403 : defaultErrorCode,
        msg: isServiceAuth ? 'Not authorized to access this resource' : 'No authorization possible. Please check your credentials'
    }
    try {
        if (isWs || isAssetUri) {
            return {
                code: 200,
                msg: 'Go ahead'
            }
        }
        else if (isServiceAuth && (checkServiceExists(host) || checkServiceExists(referer))) {
            try {
                const domain = serviceCookie.split(';').find(part => part.trim().startsWith('Domain'))?.split('=')[1]
                if(domain) {
                    const key = unsign(parse(serviceCookie)[SERVICE_AUTH_KEY], process.env.SECRET).value
                    const stored = (await getDocument(COLLECTIONS.services, {_id: domain}, {_id: 0, value: 1}, false)).value
                    if(key === stored) {
                        return {
                            code: 200,
                            msg: 'Services can go'
                        }
                    }
                }
            }
            catch (e) {
                return authReturn
            }
        }
        else if (authHeader) {
            const [name, pw] = atob(authHeader.split('Basic')[1]).split(':')
            const projection = {_id: 0, password: 1}
            const doc = await getDocument(isServiceAuth ? COLLECTIONS.services : COLLECTIONS.users, {[isServiceAuth ? '_id' : 'name']: name}, projection)
            const passwd = getHashString(name, isServiceAuth ? process.env.SECRET + pw : pw)

            if (await argon2.verify(base + (isServiceAuth ? doc.auth : doc.password), passwd)) {
                return {
                    code: 200,
                    msg: 'Authentication successful'
                }
            }
            else {
                return authReturn
            }
        }
        return authReturn
    } catch (err) {
        if(err.code === 404) {
            return {
                code: 422,
                msg: `Resource not found. Please contact an administrator!`
            }
        }
        return authReturn
    }
}

export function verifyMaster({authorization}) {
    if (!!authorization && authorization.startsWith('Bearer')) {
        const auth = authorization.split('Bearer')[1].trim()
        if (process.env.MASTER_AUTH === auth) {
            return {
                code: 200,
                msg: 'Authorized'
            }
        }
    }
    throw {
        code: 403,
        msg: 'Not authorized!'
    }
}

export function getHashString(name, password) {
    return [name, password].join('|')
}

export async function hash(hash) {
    return (await argon2.hash(hash)).substring(base.length)
}

export async function getUser() {
    const users = await getUsersList()
    if (users.length === 0) {
        throw {
            code: 409,
            msg: 'No users to show!'
        }
    }
    return users.map(u => u.name)
}

export function checkServiceExists(serviceName) {
    return services.some(service => service.url.includes(serviceName))
}

export function getCookie(value, domain) {
    const options = {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict'
    }
    if(domain) options.domain = domain
    return serialize('serviceAuth',sign(value, process.env.SECRET), options)
}