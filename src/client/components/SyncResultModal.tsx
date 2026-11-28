import React from 'react';
import Dialog from './Dialog';
import Icon from './Icon';
import { DownloadDoneMorph } from './MorphIcon';
import Marquee from './Marquee';
import SourceBadge from './SourceBadge';
import { getT, type Lang } from '../i18n';
import type { SyncResult } from '../../types';

interface SyncResultModalProps {
    lang: Lang;
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

    const getSubtitleText = (): string =>
        hasNewFiles
            ? `${result.totalDownloaded} ${t(result.totalDownloaded === 1 ? 'resultNewFileOne' : 'resultNewFiles')} ${formatDuration(result.duration)}`
            : `${t('resultNothingNew')} · ${result.totalScanned} ${t(result.totalScanned === 1 ? 'fileVerifiedOne' : 'filesVerified')}`;

    return (
        <Dialog overlayClassName="modal-overlay" className="modal-container" labelledBy="sync-result-title" onClose={onClose}>
            <div className="modal-header">
                <div className="modal-status-icon">
                    {hasNewFiles ? (
                        <DownloadDoneMorph size={26} />
                    ) : (
                        <Icon name="checkCircle" size={26} />
                    )}
                </div>
                <h2 id="sync-result-title" className="modal-title">
                    {hasNewFiles ? t('syncingPhaseComplete') : t('upToDate')}
                </h2>
                <p className="modal-subtitle">
                    {getSubtitleText()}
                </p>
            </div>

            {result.warnings?.length > 0 && (
                <div className="modal-warnings">
                    {result.warnings.map((w, idx) => (
                        <div key={idx} className="modal-warning">
                            <Icon name="warning" size={13} />
                            <span>{w}</span>
                        </div>
                    ))}
                </div>
            )}

            {hasNewFiles && (
                <div className="modal-body">
                    {result.courses.map((course, idx) => (
                        <div key={idx} className="modal-course">
                            <div className="modal-course-header">
                                <Icon name="folder" size={14} className="modal-course-icon" />
                                <Marquee className="modal-course-name" text={course.courseName} />
                                <SourceBadge webeep={course.webeep} />
                                <span className="modal-course-count">
                                    {course.files.length}
                                </span>
                            </div>
                            <ul className="modal-file-list">
                                {course.files.map((file, fIdx) => (
                                    <li key={fIdx} className="modal-file-item">
                                        <Icon name="file" size={12} className="modal-file-icon" />
                                        <Marquee className="modal-file-name" text={file} />
                                        <span className="modal-file-badge">{t('newBadge')}</span>
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
        </Dialog>
    );
};

export default SyncResultModal;
