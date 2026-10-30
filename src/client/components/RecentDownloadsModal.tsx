import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import Marquee from './Marquee';
import { getT } from '../i18n';
import { useEscape } from '../useEscape';
import type { RecentDownload } from '../../types';

interface RecentDownloadsModalProps {
    lang: 'it' | 'en';
    onClose: () => void;
}

const RecentDownloadsModal: React.FC<RecentDownloadsModalProps> = ({ lang, onClose }) => {
    useEscape(onClose);
    const t = getT(lang);
    const [files, setFiles] = useState<RecentDownload[] | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const toggleCourse = (course: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(course)) next.add(course);
            return next;
        });

    useEffect(() => {
        // Today and yesterday, but never fewer than the last 10 files, so quiet days still show
        // something. The list arrives newest first.
        const since = new Date();
        since.setDate(since.getDate() - 1);
        since.setHours(0, 0, 0, 0);
        window.api
            .getRecentDownloads()
            .then((all) => setFiles(all.filter((f, i) => i < 10 || Date.parse(f.at) >= since.getTime())))
            .catch((err) => {
                console.error('Failed to load recent downloads:', err);
                setFiles([]);
            });
    }, []);

    const open = (path: string, reveal: boolean) =>
        window.api.openRecentDownload(path, reveal).catch((err) => console.error('Failed to open file:', err));

    const locale = lang === 'en' ? 'en-US' : 'it-IT';
    const formatTime = (iso: string): string =>
        new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    // "Today", "Yesterday", "3 days ago" for the last week, then the date.
    const formatDay = (iso: string): string => {
        const day = new Date(iso);
        const daysAgo = Math.round(
            (new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000
        );
        const label = daysAgo < 7
            ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-daysAgo, 'day')
            : day.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
        return label.charAt(0).toUpperCase() + label.slice(1);
    };

    // The list arrives newest first, so the course with the latest download leads.
    const groups = new Map<string, RecentDownload[]>();
    for (const f of files ?? []) {
        groups.set(f.course, [...(groups.get(f.course) ?? []), f]);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-status-icon">
                        <Icon name="history" size={26} />
                    </div>
                    <h2 className="modal-title">{t('recentDownloads')}</h2>
                    <p className="modal-subtitle">
                        {files === null ? t('loading') : files.length > 0 ? t('recentDownloadsHint') : t('recentDownloadsEmpty')}
                    </p>
                </div>

                {groups.size > 0 && (
                    <div className="modal-body">
                        {[...groups].map(([course, courseFiles]) => (
                            <div key={course} className="modal-course">
                                <button
                                    className="modal-course-header recent-course-toggle"
                                    onClick={() => toggleCourse(course)}
                                    aria-expanded={expanded.has(course)}
                                >
                                    <span className={`term-chevron ${expanded.has(course) ? 'expanded' : ''}`}>
                                        <Icon name="caretRight" size={11} />
                                    </span>
                                    <Icon name="folder" size={14} className="modal-course-icon" />
                                    <Marquee className="modal-course-name" text={course || t('recentDownloadsNoCourse')} />
                                    <span className="modal-course-count">{courseFiles.length}</span>
                                </button>
                                {expanded.has(course) && <ul className="modal-file-list">
                                    {courseFiles.map((file) => (
                                        <li key={file.path} className="modal-file-item recent-file">
                                            <button
                                                className="recent-file-open"
                                                onClick={() => open(file.path, false)}
                                                title={file.path}
                                            >
                                                <Icon name="file" size={12} className="modal-file-icon" />
                                                <span className="recent-file-text">
                                                    <Marquee className="modal-file-name" text={file.name} />
                                                    <span className="recent-file-course">
                                                        {formatDay(file.at)} · {formatTime(file.at)}
                                                    </span>
                                                </span>
                                            </button>
                                            <button
                                                className="recent-file-reveal"
                                                onClick={() => open(file.path, true)}
                                                title={t('showInFolder')}
                                                aria-label={t('showInFolder')}
                                            >
                                                <Icon name="folderOpen" size={13} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>}
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

export default RecentDownloadsModal;
