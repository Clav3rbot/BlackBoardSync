import React from 'react';
import Dialog from './Dialog';
import Icon, { IconName } from './Icon';

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

    return (
        <Dialog overlayClassName="update-dialog-overlay" className="update-dialog" labelledBy="confirm-dialog-title" onClose={onCancel}>
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
        </Dialog>
    );
};

export default ConfirmDialog;
