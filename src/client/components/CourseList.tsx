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
    loading: boolean;
    onToggle: (courseId: string) => void;
    onRename: (courseId: string, newName: string) => void;
    onCollapsedTermsChange: (collapsed: string[]) => void;
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
    loading,
    onToggle,
    onRename,
    onCollapsedTermsChange,
}) => {
    const allEnabled = enabledCourses.length === 0;
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [activeTerm, setActiveTerm] = useState<string | null>(null);
    const [collapsedTerms, setCollapsedTerms] = useState<Set<string>>(new Set(savedCollapsedTerms));


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

    const visibleGroups = useMemo(() => {
        if (!activeTerm) return termGroups;
        return termGroups.filter((g) => g.termId === activeTerm);
    }, [termGroups, activeTerm]);

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
                <span className="section-label">Corsi ({courses.length})</span>
                {enabledCourses.length > 0 && (
                    <span className="section-badge">
                        {enabledCourses.length} selezionati
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
                    {termGroups.map((group) => (
                        <button
                            key={group.termId}
                            className={`term-pill ${activeTerm === group.termId ? 'active' : ''}`}
                            onClick={() =>
                                setActiveTerm(
                                    activeTerm === group.termId ? null : group.termId
                                )
                            }
                        >
                            {group.termName}
                        </button>
                    ))}
                </div>
            )}

            <div className="course-list">
                {visibleGroups.map((group) => {
                    const isCollapsed = collapsedTerms.has(group.termId);

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
                                        {group.courses.length}
                                    </span>
                                </div>
                            )}

                            {!isCollapsed && (
                                <div className="term-courses">
                                    {group.courses.map((course) => {
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
                                                    )}
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
