import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import { getT } from '../i18n';
import { dismissToast, useToasts, Toast } from '../toast';

const LIFETIME_MS = 2200;
const LIFETIME_WITH_TEXT_MS = 3400;

const ToastCard: React.FC<{ item: Toast; closeLabel: string }> = ({ item, closeLabel }) => {
    const [leaving, setLeaving] = useState(false);
    // The countdown stops while the pointer is on the card, so it can be read.
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (item.sticky || paused || leaving) return;
        const lifetime = item.description ? LIFETIME_WITH_TEXT_MS : LIFETIME_MS;
        const id = window.setTimeout(() => setLeaving(true), lifetime);
        return () => window.clearTimeout(id);
    }, [paused, leaving]);

    return (
        <div
            className={`toast-slot${leaving ? ' leaving' : ''}`}
            onAnimationEnd={(e) => {
                if (leaving && e.target === e.currentTarget) dismissToast(item.id);
            }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <div className="toast-clip">
                <div className={`toast toast-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
                    <Icon name={item.icon} size={16} className="toast-icon" />
                    <div className="toast-text">
                        <span className="toast-message">{item.message}</span>
                        {item.description && <span className="toast-description">{item.description}</span>}
                    </div>
                    {item.action && (
                        <button
                            className="toast-action"
                            onClick={() => {
                                item.action?.run();
                                setLeaving(true);
                            }}
                        >
                            {item.action.label}
                        </button>
                    )}
                    <button className="toast-close" onClick={() => setLeaving(true)} aria-label={closeLabel}>
                        <Icon name="close" size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
};

const Toasts: React.FC<{ lang: string }> = ({ lang }) => {
    const items = useToasts();
    const t = getT(lang);
    return (
        <div className="toasts">
            {items.map((item) => (
                <ToastCard key={item.id} item={item} closeLabel={t('close')} />
            ))}
        </div>
    );
};

export default Toasts;
