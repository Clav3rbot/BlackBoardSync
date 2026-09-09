import React, { useState, useMemo } from 'react';
import Icon from './Icon';
import { getT } from '../i18n';

interface Course {
    id: string;
    courseId: string;
    name: string;
    term?: { id: string; name: string };
    instructor?: string;
}

interface CourseListProps {
    lang: 'it' | 'en';
    courses: Course[];
    syncAll: boolean;
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    collapsedTerms: string[];
    hiddenCourses: string[];
    hiddenTerms: string[];
    loading: boolean;
    loadingInstructors?: boolean;
    cacheMisses?: Set<string>;
    onToggle: (courseId: string) => void;
    onRename: (courseId: string, newName: string) => void;
    onCollapsedTermsChange: (collapsed: string[]) => void;
    onHide: (courseId: string) => void;
    onUnhide: (courseId: string) => void;
    onHideTerm: (termId: string) => void;
    onUnhideTerm: (termId: string) => void;
}

interface TermGroup {
    termId: string;
    termName: string;
    courses: Course[];
}

const CourseList: React.FC<CourseListProps> = ({
    lang,
    courses,
    syncAll,
    enabledCourses,
    courseAliases,
    collapsedTerms: savedCollapsedTerms,
    hiddenCourses,
    hiddenTerms,
    loading,
    loadingInstructors,
    cacheMisses,
    onToggle,
    onRename,
    onCollapsedTermsChange,
    onHide,
    onUnhide,
    onHideTerm,
    onUnhideTerm,
}) => {
    const t = getT(lang);
    const allEnabled = syncAll;
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [collapsedTerms, setCollapsedTerms] = useState<Set<string>>(new Set(savedCollapsedTerms));
    const [revealedTerms, setRevealedTerms] = useState<Set<string>>(new Set());
    const [showHiddenTermPills, setShowHiddenTermPills] = useState(false);
    const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);



    const termGroups = useMemo<TermGroup[]>(() => {
        const groups: Record<string, TermGroup> = {};
        const noTerm: Course[] = [];

        for (const course of courses) {
            if (course.term?.id) {
                if (!groups[course.term.id]) {
                    groups[course.term.id] = {
                        termId: course.term.id,
                        termName: course.term.name || course.term.id,
                        courses: [],
                    };
                }
                groups[course.term.id].courses.push(course);
            } else {
                noTerm.push(course);
            }
        }

        const semesterGroups = Object.values(groups).filter((g) => {
            const lower = g.termName.toLowerCase();
            return lower.includes('semester') || lower.includes('semestre');
        });
        const otherGroups = Object.values(groups).filter((g) => {
            const lower = g.termName.toLowerCase();
            return !lower.includes('semester') && !lower.includes('semestre');
        });

        semesterGroups.sort((a, b) => {
            const aName = a.termName.toUpperCase();
            const bName = b.termName.toUpperCase();
            const aYear = aName.match(/\d{4}\/\d{4}/)?.[0] || '';
            const bYear = bName.match(/\d{4}\/\d{4}/)?.[0] || '';
            if (aYear !== bYear) return bYear.localeCompare(aYear);
            const aIsSecond = aName.includes('SECOND') || aName.includes('SECONDO');
            const bIsSecond = bName.includes('SECOND') || bName.includes('SECONDO');
            if (aIsSecond && !bIsSecond) return -1;
            if (!aIsSecond && bIsSecond) return 1;
            return bName.localeCompare(aName);
        });

        otherGroups.sort((a, b) => b.termName.localeCompare(a.termName));

        const result = [...semesterGroups, ...otherGroups];

        if (noTerm.length > 0) {
            result.push({ termId: '__none__', termName: t('termOther'), courses: noTerm });
        }

        return result;
    }, [courses, lang]);

    const visibleTermGroups = useMemo(
        () => termGroups.filter((g) => !hiddenTerms.includes(g.termId)),
        [termGroups, hiddenTerms]
    );

    const hiddenTermGroups = useMemo(
        () => termGroups.filter((g) => hiddenTerms.includes(g.termId)),
        [termGroups, hiddenTerms]
    );

    const visibleGroups = useMemo(() => {
        if (!activeTerm) return visibleTermGroups;
        return visibleTermGroups.filter((g) => g.termId === activeTerm);
    }, [visibleTermGroups, activeTerm]);

    const toggleTermCollapse = (termId: string) => {
        setCollapsedTerms((prev) => {
            const next = new Set(prev);
            if (next.has(termId)) {
                next.delete(termId);
            } else {
                next.add(termId);
            }
            onCollapsedTermsChange(Array.from(next));
            return next;
        });
    };

    const toggleRevealedTerm = (termId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setRevealedTerms((prev) => {
            const next = new Set(prev);
            if (next.has(termId)) {
                next.delete(termId);
            } else {
                next.add(termId);
            }
            return next;
        });
    };



    if (loading) {
        return (
            <div className="section course-section">
                <div className="section-header">
                    <span className="section-label">{t('coursesHeader')}</span>
                </div>
                <div className="course-list-skeleton" aria-busy="true" aria-label={t('loadingCourses')}>
                    {[0, 1, 2].map((g) => (
                        <div className="skeleton-group" key={g}>
                            <div className="skeleton-term" />
                            {Array.from({ length: 3 - (g % 2) }).map((_, r) => (
                                <div className="skeleton-row" key={r}>
                                    <div className="skeleton-box" />
                                    <div className="skeleton-lines">
                                        <div className="skeleton-line" />
                                        <div className="skeleton-line short" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (courses.length === 0) {
        return (
            <div className="section course-section">
                <div className="section-header">
                    <span className="section-label">{t('coursesHeader')}</span>
                </div>
                <div className="course-list-empty">
                    <div className="empty-icon">
                        <Icon name="folder" size={26} weight="light" />
                    </div>
                    <p className="empty-title">{t('coursesEmpty')}</p>
                    <p className="empty-hint">{t('coursesEmptyHint')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="section course-section">
            {actionsOpenId && (
                <div className="actions-backdrop" onMouseDown={() => setActionsOpenId(null)} />
            )}
            <div className="section-header">
                <span className="section-label">{t('coursesHeader')} ({courses.length - hiddenCourses.length})</span>
                {!allEnabled && (
                    <span className="section-badge">
                        {enabledCourses.length} {t('coursesSelected')}
                    </span>
                )}
            </div>

            {termGroups.length > 1 && (
                <div className="term-filters">
                    <button
                        className={`term-pill ${activeTerm === null ? 'active' : ''}`}
                        onClick={() => setActiveTerm(null)}
                    >
                        {t('termFilterAll')}
                    </button>
                    {visibleTermGroups.map((group) => (
                        <span key={group.termId} className={`term-pill-wrap ${activeTerm === group.termId ? 'active' : ''}`}>
                            <button
                                className="term-pill-label"
                                onClick={() =>
                                    setActiveTerm(
                                        activeTerm === group.termId ? null : group.termId
                                    )
                                }
                            >
                                {group.termName}
                            </button>
                            <button
                                className="term-pill-hide-btn"
                                onClick={(e) => { e.stopPropagation(); onHideTerm(group.termId); }}
                                title={t('hideTermTooltip')}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {hiddenTermGroups.length > 0 && (
                        <>
                            <button
                                className={`term-pill term-pill-hidden-toggle ${showHiddenTermPills ? 'active' : ''}`}
                                onClick={() => setShowHiddenTermPills((v) => !v)}
                                title={showHiddenTermPills ? t('hideHiddenTermsTooltip') : `${t('showHiddenTermsTooltip')} (${hiddenTermGroups.length})`}
                            >
                                <Icon name="hide" size={12} />
                                <span>{hiddenTermGroups.length}</span>
                            </button>
                            {showHiddenTermPills && hiddenTermGroups.map((group) => (
                                <span key={group.termId} className="term-pill hidden-term">
                                    <span className="hidden-term-name">{group.termName}</span>
                                    <button
                                        className="term-pill-unhide-x"
                                        onClick={(e) => { e.stopPropagation(); onUnhideTerm(group.termId); }}
                                        title={t('restoreTermTooltip')}
                                    >
                                        <Icon name="close" size={11} />
                                    </button>
                                </span>
                            ))}
                        </>
                    )}
                </div>
            )}

            <div className="course-list">
                {visibleGroups.map((group) => {
                    const isCollapsed = collapsedTerms.has(group.termId);
                    const isRevealed = revealedTerms.has(group.termId);
                    const visibleCourses = group.courses.filter(c => !hiddenCourses.includes(c.id));
                    const hiddenCoursesInTerm = group.courses.filter(c => hiddenCourses.includes(c.id));
                    const hiddenCount = hiddenCoursesInTerm.length;

                    return (
                        <div key={group.termId} className="term-group">
                            {termGroups.length > 1 && (
                                <div
                                    className="term-header"
                                    onClick={() => toggleTermCollapse(group.termId)}
                                >
                                    <span
                                        className={`term-chevron ${isCollapsed ? '' : 'expanded'}`}
                                    >
                                        <Icon name="caretRight" size={11} />
                                    </span>
                                    <span className="term-name">{group.termName}</span>
                                    <span className="term-count">
                                        {visibleCourses.length}
                                    </span>
                                    {hiddenCount > 0 && (
                                        <button
                                            className={`term-hidden-btn ${isRevealed ? 'active' : ''}`}
                                            onClick={(e) => toggleRevealedTerm(group.termId, e)}
                                            title={isRevealed ? t('actionHide') : `${hiddenCount} ${t('hiddenCoursesCount')}`}
                                        >
                                            {isRevealed ? (
                                                <Icon name="show" size={11} />
                                            ) : (
                                                <span className="term-hidden-count">{hiddenCount}</span>
                                            )}
                                        </button>
                                    )}
                                </div>
                            )}

                            {!isCollapsed && (
                                <div className="term-courses">
                                    {visibleCourses.map((course) => {
                                        const isEnabled =
                                            allEnabled ||
                                            enabledCourses.includes(course.id);
                                        const displayName =
                                            courseAliases[course.id] || course.name;
                                        const isEditing = editingId === course.id;


                                        const startEditing = (
                                            e: React.MouseEvent
                                        ) => {
                                            e.stopPropagation();
                                            setEditingId(course.id);
                                            setEditValue(displayName);
                                        };

                                        const confirmRename = () => {
                                            const trimmed = editValue.trim();
                                            if (trimmed && trimmed !== course.name) {
                                                onRename(course.id, trimmed);
                                            } else if (
                                                !trimmed ||
                                                trimmed === course.name
                                            ) {
                                                onRename(course.id, '');
                                            }
                                            setEditingId(null);
                                        };

                                        const handleKeyDown = (
                                            e: React.KeyboardEvent
                                        ) => {
                                            if (e.key === 'Enter') confirmRename();
                                            if (e.key === 'Escape')
                                                setEditingId(null);
                                        };

                                        return (
                                            <div key={course.id} className={`course-item${actionsOpenId === course.id ? ' item-active' : ''}`}>
                                                <div
                                                    className={`course-row ${isEnabled ? 'enabled' : 'disabled'}`}
                                                >
                                                    <div
                                                        className={`checkbox ${isEnabled ? 'checked' : ''}`}
                                                        onClick={() =>
                                                            onToggle(course.id)
                                                        }
                                                    >
                                                        {isEnabled && (
                                                            <Icon name="check" size={12} />
                                                        )}
                                                    </div>
                                                    <div
                                                        className="course-info"
                                                        onClick={() =>
                                                            onToggle(course.id)
                                                        }
                                                    >
                                                        {isEditing ? (
                                                            <input
                                                                className="course-rename-input"
                                                                value={editValue}
                                                                onChange={(e) =>
                                                                    setEditValue(
                                                                        e.target.value
                                                                    )
                                                                }
                                                                onBlur={
                                                                    confirmRename
                                                                }
                                                                onKeyDown={
                                                                    handleKeyDown
                                                                }
                                                                onClick={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <span className="course-name">
                                                                {displayName}
                                                            </span>
                                                        )}
                                                        {course.instructor && !isEditing ? (
                                                            <span className={`course-instructor${cacheMisses?.has(course.id) ? ' fade-in' : ''}`}>
                                                                {course.instructor}
                                                            </span>
                                                        ) : (loadingInstructors && !isEditing && cacheMisses?.has(course.id)) ? (
                                                            <div className="course-instructor-skeleton">
                                                                <span className="skeleton-dot" />
                                                                <span className="skeleton-bar" />
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    {!isEditing && (
                                                        <div
                                                            className={`course-actions${actionsOpenId === course.id ? ' active' : ''}`}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                        >
                                                            <button
                                                                className={`course-actions-trigger${actionsOpenId === course.id ? ' active' : ''}`}
                                                                onClick={(e) => { e.stopPropagation(); setActionsOpenId(actionsOpenId === course.id ? null : course.id); }}
                                                                title={t('actionsTooltip')}
                                                            >
                                                                <Icon name="dots" size={15} />
                                                            </button>
                                                            {actionsOpenId === course.id && (
                                                                <div className="course-actions-popup">
                                                                    <button
                                                                        className="course-actions-popup-item"
                                                                        onClick={(e) => { e.stopPropagation(); setActionsOpenId(null); setEditingId(course.id); setEditValue(displayName); }}
                                                                    >
                                                                        <Icon name="pencil" size={13} />
                                                                        {t('actionRename')}
                                                                    </button>
                                                                    <button
                                                                        className="course-actions-popup-item danger"
                                                                        onClick={(e) => { e.stopPropagation(); setActionsOpenId(null); onHide(course.id); }}
                                                                    >
                                                                        <Icon name="hide" size={13} />
                                                                        {t('actionHide')}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {isRevealed && hiddenCoursesInTerm.map((course) => {
                                        const displayName = courseAliases[course.id] || course.name;
                                        return (
                                            <div key={course.id} className="course-item">
                                                <div className="course-row course-hidden">
                                                    <div className="course-info">
                                                        <span className="course-name">{displayName}</span>
                                                        {course.instructor ? (
                                                            <span className={`course-instructor${cacheMisses?.has(course.id) ? ' fade-in' : ''}`}>{course.instructor}</span>
                                                        ) : (loadingInstructors && cacheMisses?.has(course.id)) ? (
                                                            <div className="course-instructor-skeleton">
                                                                <span className="skeleton-dot" />
                                                                <span className="skeleton-bar" />
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <button
                                                        className="btn-unhide"
                                                        onClick={(e) => { e.stopPropagation(); onUnhide(course.id); }}
                                                        title={t('actionUnhide')}
                                                    >
                                                            <Icon name="show" size={13} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CourseList;
