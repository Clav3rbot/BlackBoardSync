import axios, { AxiosResponse } from 'axios';
import { load } from 'cheerio';
import { LoginResult } from '../types.d';

const BASE_URL = 'https://blackboard.unibocconi.it';

class CookieJar {
    private cookies: Map<string, Map<string, string>> = new Map();

    processResponse(url: string, response: AxiosResponse): void {
        const setCookies = response.headers['set-cookie'];
        if (!setCookies) return;

        const hostname = new URL(url).hostname;
        if (!this.cookies.has(hostname)) {
            this.cookies.set(hostname, new Map());
        }
        const jar = this.cookies.get(hostname)!;

        for (const header of setCookies) {
            const cookiePart = header.split(';')[0];
            const eqIdx = cookiePart.indexOf('=');
            if (eqIdx > 0) {
                const name = cookiePart.substring(0, eqIdx).trim();
                const value = cookiePart.substring(eqIdx + 1).trim();
                jar.set(name, value);
            }
        }
    }

    getCookieHeader(url: string): string {
        const hostname = new URL(url).hostname;
        const jar = this.cookies.get(hostname);
        if (!jar || jar.size === 0) return '';
        return Array.from(jar.entries())
            .map(([n, v]) => `${n}=${v}`)
            .join('; ');
    }

    getSessionCookies(hostname: string): string[] {
        const jar = this.cookies.get(hostname);
        if (!jar) return [];
        return Array.from(jar.entries()).map(([n, v]) => `${n}=${v}`);
    }
}

export class LoginManager {
    private jar: CookieJar;

    constructor() {
        this.jar = new CookieJar();
    }

    private async request(
        method: 'GET' | 'POST',
        url: string,
        data?: string,
        contentType?: string,
        followRedirects = false
    ): Promise<{ response: AxiosResponse; finalUrl: string }> {
        let currentUrl = url;
        let currentMethod = method;
        let currentData: string | undefined = data;
        let maxHops = 25;

        while (maxHops > 0) {
            const headers: Record<string, string> = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0',
            };

            const cookieStr = this.jar.getCookieHeader(currentUrl);
            if (cookieStr) headers['Cookie'] = cookieStr;
            if (currentData && contentType) headers['Content-Type'] = contentType;

            const response = await axios({
                method: currentMethod,
                url: currentUrl,
                data: currentMethod === 'POST' ? currentData : undefined,
                headers,
                maxRedirects: 0,
                validateStatus: () => true,
                responseType: 'text',
                timeout: 30000,
            });

            this.jar.processResponse(currentUrl, response);

            if (followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.location;
                if (!location) break;
                currentUrl = new URL(location, currentUrl).toString();
                if (response.status === 303 || currentMethod === 'POST') {
                    currentMethod = 'GET';
                    currentData = undefined;
                }
                maxHops--;
                continue;
            }

            return { response, finalUrl: currentUrl };
        }

        throw new Error('Troppi redirect durante il login');
    }

    async login(username: string, password: string): Promise<LoginResult> {
        try {
            this.jar = new CookieJar();

            const step1 = await this.request(
                'GET',
                `${BASE_URL}/ultra/course`,
                undefined,
                undefined,
                true
            );

            const $1 = load(step1.response.data);
            const samlForm = $1('form');
            const samlAction = samlForm.attr('action');
            const samlRequest = $1('input[name="SAMLRequest"]').val() as string;
            const relayState = $1('input[name="RelayState"]').val() as string;

            if (!samlAction || !samlRequest) {
                return {
                    success: false,
                    cookies: [],
                    error: 'Impossibile trovare il form SAML. Il flusso SSO potrebbe essere cambiato.',
                };
            }

            const samlUrl = samlAction.startsWith('http')
                ? samlAction
                : new URL(samlAction, step1.finalUrl).toString();

            const samlBody = new URLSearchParams();
            samlBody.append('SAMLRequest', samlRequest);
            if (relayState) samlBody.append('RelayState', relayState);

            const step2 = await this.request(
                'POST',
                samlUrl,
                samlBody.toString(),
                'application/x-www-form-urlencoded',
                true
            );

            const $2 = load(step2.response.data);
            const loginForm = $2('form');
            const loginAction = loginForm.attr('action');

            if (!loginAction) {
                return {
                    success: false,
                    cookies: [],
                    error: 'Impossibile trovare il form di login nell\'IDP.',
                };
            }

            const loginUrl = loginAction.startsWith('http')
                ? loginAction
                : new URL(loginAction, step2.finalUrl).toString();

            const credBody = new URLSearchParams();
            credBody.append('j_username', username);
            credBody.append('j_password', password);
            credBody.append('_eventId_proceed', '');

            const step3 = await this.request(
                'POST',
                loginUrl,
                credBody.toString(),
                'application/x-www-form-urlencoded',
                false
            );

            const $3 = load(step3.response.data);

            const errorEl = $3('.error');
            if (errorEl.length > 0) {
                const errorText = errorEl.text().trim();
                return {
                    success: false,
                    cookies: [],
                    error: errorText || 'Credenziali non valide',
                };
            }

            const samlResponse = $3('input[name="SAMLResponse"]').val() as string;
            const returnRelayState = $3('input[name="RelayState"]').val() as string;
            const returnAction = $3('form').attr('action');

            if (!samlResponse || !returnAction) {
                return {
                    success: false,
                    cookies: [],
                    error: 'Autenticazione fallita. Nessuna risposta SAML ricevuta.',
                };
            }

            const returnBody = new URLSearchParams();
            returnBody.append('SAMLResponse', samlResponse);
            if (returnRelayState) returnBody.append('RelayState', returnRelayState);

            await this.request(
                'POST',
                returnAction,
                returnBody.toString(),
                'application/x-www-form-urlencoded',
                true
            );

            const sessionCookies = this.jar.getSessionCookies('blackboard.unibocconi.it');

            if (sessionCookies.length === 0) {
                return {
                    success: false,
                    cookies: [],
                    error: 'Login riuscito ma nessun cookie di sessione ricevuto.',
                };
            }

            return { success: true, cookies: sessionCookies };
        } catch (error: any) {
            return {
                success: false,
                cookies: [],
                error: error.message || 'Errore di connessione',
            };
        }
    }
}
