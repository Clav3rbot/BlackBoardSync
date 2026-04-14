import React, { useState, useMemo } from 'react';

interface Course {
    id: string;
    courseId: string;
    name: string;
    term?: { id: string; name: string };
    instructor?: string;
}

interface CourseListProps {
    courses: Course[];
    enabledCourses: string[];
    courseAliases: Record<string, string>;
    collapsedTerms: string[];
    hiddenCourses: string[];
    hiddenTerms: string[];
    loading: boolean;
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
    courses,
    enabledCourses,
    courseAliases,
    collapsedTerms: savedCollapsedTerms,
    hiddenCourses,
    hiddenTerms,
    loading,
    onToggle,
    onRename,
    onCollapsedTermsChange,
    onHide,
    onUnhide,
    onHideTerm,
    onUnhideTerm,
}) => {
    const allEnabled = enabledCourses.length === 0;
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [collapsedTerms, setCollapsedTerms] = useState<Set<string>>(new Set(savedCollapsedTerms));
    const [revealedTerms, setRevealedTerms] = useState<Set<string>>(new Set());
    const [showHiddenTermPills, setShowHiddenTermPills] = useState(false);


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
            result.push({ termId: '__none__', termName: 'Altro', courses: noTerm });
        }

        return result;
    }, [courses]);

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
                    <span className="section-label">Corsi</span>
                </div>
                <div className="course-list-loading">
                    <div className="spinner-small" />
                    <span>Caricamento corsi...</span>
                </div>
            </div>
        );
    }

    if (courses.length === 0) {
        return (
            <div className="section course-section">
                <div className="section-header">
                    <span className="section-label">Corsi</span>
                </div>
                <div className="course-list-empty">
                    <p>Nessun corso trovato</p>
                </div>
            </div>
        );
    }

    return (
        <div className="section course-section">
            <div className="section-header">
                <span className="section-label">Corsi ({courses.length - hiddenCourses.length})</span>
                {enabledCourses.length > 0 && (
                    <span className="section-badge">
                        {enabledCourses.length} selezionati
                    </span>
                )}
                {hiddenCourses.length > 0 && (
                    <span className="section-badge section-badge-hidden">
                        {hiddenCourses.length} nascosti
                    </span>
                )}
            </div>

            {termGroups.length > 1 && (
                <div className="term-filters">
                    <button
                        className={`term-pill ${activeTerm === null ? 'active' : ''}`}
                        onClick={() => setActiveTerm(null)}
                    >
                        Tutti
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
                                title="Nascondi categoria"
                            >
                                nascondi
                            </button>
                        </span>
                    ))}
                    {hiddenTermGroups.length > 0 && (
                        <>
                            <button
                                className={`term-pill term-pill-hidden-toggle ${showHiddenTermPills ? 'active' : ''}`}
                                onClick={() => setShowHiddenTermPills((v) => !v)}
                                title={showHiddenTermPills ? 'Nascondi categorie nascoste' : `Mostra ${hiddenTermGroups.length} categorie nascoste`}
                            >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                                    <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                                    <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                                    <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                                </svg>
                                <span>{hiddenTermGroups.length}</span>
                            </button>
                            {showHiddenTermPills && hiddenTermGroups.map((group) => (
                                <span key={group.termId} className="term-pill hidden-term">
                                    <span className="hidden-term-name">{group.termName}</span>
                                    <button
                                        className="term-pill-unhide-x"
                                        onClick={(e) => { e.stopPropagation(); onUnhideTerm(group.termId); }}
                                        title="Ripristina categoria"
                                    >
                                        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                                            <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                                        </svg>
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
                                        <svg
                                            width="10"
                                            height="10"
                                            viewBox="0 0 10 10"
                                            fill="currentColor"
                                        >
                                            <path d="M3 2l4 3-4 3V2z" />
                                        </svg>
                                    </span>
                                    <span className="term-name">{group.termName}</span>
                                    <span className="term-count">
                                        {visibleCourses.length}
                                    </span>
                                    {hiddenCount > 0 && (
                                        <button
                                            className={`term-hidden-btn ${isRevealed ? 'active' : ''}`}
                                            onClick={(e) => toggleRevealedTerm(group.termId, e)}
                                            title={isRevealed ? 'Nascondi nascosti' : `Mostra ${hiddenCount} nascosti`}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                                                <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                                                <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                                            </svg>
                                            <span>{hiddenCount}</span>
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
                                            <div key={course.id} className="course-item">
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
                                                            <svg
                                                                width="12"
                                                                height="12"
                                                                viewBox="0 0 12 12"
                                                                fill="currentColor"
                                                            >
                                                                <path d="M10.28 2.28a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 011.06-1.06L4.25 7.22l4.97-4.94a.75.75 0 011.06 0z" />
                                                            </svg>
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
                                                        {course.instructor && !isEditing && (
                                                            <span className="course-instructor">
                                                                {course.instructor}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!isEditing && (
                                                        <>
                                                            <button
                                                                className="btn-rename"
                                                                onClick={startEditing}
                                                                title="Rinomina"
                                                            >
                                                                <svg
                                                                    width="12"
                                                                    height="12"
                                                                    viewBox="0 0 16 16"
                                                                    fill="currentColor"
                                                                >
                                                                    <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.5-6.5z" />
                                                                </svg>
                                                            </button>
                                                            <button
                                                                className="btn-hide"
                                                                onClick={(e) => { e.stopPropagation(); onHide(course.id); }}
                                                                title="Nascondi"
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                                                    <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/>
                                                                    <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/>
                                                                    <path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12-.708.708z"/>
                                                                </svg>
                                                            </button>
                                                        </>
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
                                                        {course.instructor && (
                                                            <span className="course-instructor">{course.instructor}</span>
                                                        )}
                                                    </div>
                                                    <button
                                                        className="btn-unhide"
                                                        onClick={(e) => { e.stopPropagation(); onUnhide(course.id); }}
                                                        title="Mostra"
                                                    >
                                                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                                            <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/>
                                                            <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/>
                                                        </svg>
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
