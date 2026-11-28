import React, { useRef } from 'react';
import { useEscape } from '../useEscape';
import { useFocusTrap } from '../useFocusTrap';

interface DialogProps {
    overlayClassName: string;
    className: string;
    labelledBy: string;
    onClose: () => void;
    children: React.ReactNode;
}

// Escape and a click outside close it; focus stays inside while it is open.
const Dialog: React.FC<DialogProps> = ({ overlayClassName, className, labelledBy, onClose, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref);
    useEscape(onClose);

    return (
        <div className={overlayClassName} onClick={onClose}>
            <div
                ref={ref}
                className={className}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
};

export default Dialog;
