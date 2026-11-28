import React from 'react';

// University names, the same in both languages.
const SourceBadge: React.FC<{ webeep: boolean }> = ({ webeep }) => (
    <span className="course-source">{webeep ? 'PoliMi' : 'Bocconi'}</span>
);

export default SourceBadge;
