import React from 'react';
import Icon from './Icon';
import { getT } from '../i18n';

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
    lang: 'it' | 'en';
    result: SyncResult;
    onClose: () => void;
}

const SyncResultModal: React.FC<SyncResultModalProps> = ({ lang, result, onClose }) => {
    const hasNewFiles = result.totalDownloaded > 0;
    const t = getT(lang);

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    };

    const getSubtitleText = (): string => {
        if (lang === 'en') {
            return hasNewFiles
                ? `${result.totalDownloaded} new file${result.totalDownloaded === 1 ? '' : 's'} downloaded in ${formatDuration(result.duration)}`
                : `No new files found · ${result.totalScanned} file${result.totalScanned === 1 ? '' : 's'} verified`;
        } else {
            return hasNewFiles
                ? `${result.totalDownloaded} nuov${result.totalDownloaded === 1 ? 'o file' : 'i file'} scaricati in ${formatDuration(result.duration)}`
                : `Nessun nuovo file trovato · ${result.totalScanned} file verificati`;
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-status-icon">
                        {hasNewFiles ? (
                            <Icon name="download" size={26} />
                        ) : (
                            <Icon name="checkCircle" size={26} />
                        )}
                    </div>
                    <h2 className="modal-title">
                        {hasNewFiles 
                            ? (lang === 'en' ? 'Synchronization completed' : 'Sincronizzazione completata')
                            : (lang === 'en' ? 'Everything up to date' : 'Tutto aggiornato')}
                    </h2>
                    <p className="modal-subtitle">
                        {getSubtitleText()}
                    </p>
                </div>

                {hasNewFiles && (
                    <div className="modal-body">
                        {result.courses.map((course, idx) => (
                            <div key={idx} className="modal-course">
                                <div className="modal-course-header">
                                <Icon name="warning" size={14} className="modal-course-icon" />
                                    <span className="modal-course-name">{course.courseName}</span>
                                    <span className="modal-course-count">
                                        {course.files.length}
                                    </span>
                                </div>
                                <ul className="modal-file-list">
                                    {course.files.map((file, fIdx) => (
                                        <li key={fIdx} className="modal-file-item">
                                            <Icon name="file" size={12} className="modal-file-icon" />
                                            <span className="modal-file-name">{file}</span>
                                            <span className="modal-file-badge">{lang === 'en' ? 'NEW' : 'NUOVO'}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}

                <div className="modal-footer">
                    <button className="modal-close-btn" onClick={onClose}>
                        {t('close')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SyncResultModal;
