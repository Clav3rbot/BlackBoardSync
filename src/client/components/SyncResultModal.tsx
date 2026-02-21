import React from 'react';

interface SyncResultCourse {
    courseName: string;
    files: string[];
}

interface SyncResult {
    totalDownloaded: number;
    totalScanned: number;
    courses: SyncResultCourse[];
    duration: number;
}

interface SyncResultModalProps {
    result: SyncResult;
    onClose: () => void;
}

const SyncResultModal: React.FC<SyncResultModalProps> = ({ result, onClose }) => {
    const hasNewFiles = result.totalDownloaded > 0;

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-status-icon">
                        {hasNewFiles ? (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        ) : (
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                        )}
                    </div>
                    <h2 className="modal-title">
                        {hasNewFiles ? 'Sincronizzazione completata' : 'Tutto aggiornato'}
                    </h2>
                    <p className="modal-subtitle">
                        {hasNewFiles
                            ? `${result.totalDownloaded} nuov${result.totalDownloaded === 1 ? 'o file' : 'i file'} scaricati in ${formatDuration(result.duration)}`
                            : `Nessun nuovo file trovato · ${result.totalScanned} file verificati`}
                    </p>
                </div>

                {hasNewFiles && (
                    <div className="modal-body">
                        {result.courses.map((course, idx) => (
                            <div key={idx} className="modal-course">
                                <div className="modal-course-header">
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="modal-course-icon">
                                        <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7H1.75z" />
                                    </svg>
                                    <span className="modal-course-name">{course.courseName}</span>
                                    <span className="modal-course-count">
                                        {course.files.length}
                                    </span>
                                </div>
                                <ul className="modal-file-list">
                                    {course.files.map((file, fIdx) => (
                                        <li key={fIdx} className="modal-file-item">
                                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="modal-file-icon">
                                                <path d="M3.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75zM2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75z" />
                                            </svg>
                                            <span className="modal-file-name">{file}</span>
                                            <span className="modal-file-badge">NUOVO</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}

                <div className="modal-footer">
                    <button className="modal-close-btn" onClick={onClose}>
                        Chiudi
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SyncResultModal;
