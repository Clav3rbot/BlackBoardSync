import type { LoginResult, Provider, UserInfo } from '../types';

// The user goes to onLogin; otherwise the error text, or `fallback` when the call gives none.
export async function connect(
    provider: Provider,
    call: () => Promise<LoginResult>,
    onLogin: (provider: Provider, user: UserInfo) => void,
    fallback: string
): Promise<string> {
    try {
        const result = await call();
        if (!result.success) return result.error || fallback;
        onLogin(provider, result.user);
        return '';
    } catch {
        return fallback;
    }
}
