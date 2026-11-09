import React, { useRef } from 'react';
import Icon, { IconName } from './Icon';
import { useEscape } from '../useEscape';
import { useFocusTrap } from '../useFocusTrap';

interface ConfirmDialogProps {
    icon: IconName;
    title: string;
    text: string;
    subtext: string;
    cancelLabel: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    icon,
    title,
    text,
    subtext,
    cancelLabel,
    confirmLabel,
    onCancel,
    onConfirm,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref);
    useEscape(onCancel);

    return (
        <div className="update-dialog-overlay" onClick={onCancel}>
            <div
                ref={ref}
                className="update-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="update-dialog-icon">
                    <Icon name={icon} size={30} />
                </div>
                <h3 id="confirm-dialog-title" className="update-dialog-title">{title}</h3>
                <p className="update-dialog-text">{text}</p>
                <p className="update-dialog-subtext">{subtext}</p>
                <div className="update-dialog-actions">
                    <button className="btn-update-later" onClick={onCancel}>{cancelLabel}</button>
                    <button className="btn-update-restart" onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
