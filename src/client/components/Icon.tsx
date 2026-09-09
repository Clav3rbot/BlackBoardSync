import React from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CornersOutIcon } from '@phosphor-icons/react/dist/csr/CornersOut';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { FileIcon } from '@phosphor-icons/react/dist/csr/File';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { FolderSimpleIcon } from '@phosphor-icons/react/dist/csr/FolderSimple';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';

const GLYPHS = {
    caretRight: CaretRightIcon,
    check: CheckIcon,
    checkCircle: CheckCircleIcon,
    close: XIcon,
    dots: DotsThreeIcon,
    download: DownloadSimpleIcon,
    file: FileIcon,
    folder: FolderSimpleIcon,
    folderOpen: FolderOpenIcon,
    hide: EyeSlashIcon,
    minimize: MinusIcon,
    pencil: PencilSimpleIcon,
    resize: CornersOutIcon,
    settings: GearSixIcon,
    show: EyeIcon,
    signOut: SignOutIcon,
    sync: ArrowsClockwiseIcon,
    warning: WarningIcon,
} as const;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
    name: IconName;
    size?: number;
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill';
    className?: string;
}

const Icon: React.FC<IconProps> = ({ name, size = 16, weight, className }) => {
    const Glyph = GLYPHS[name];
    return (
        <Glyph
            size={size}
            weight={weight ?? (size <= 12 ? 'bold' : 'regular')}
            className={className}
            style={{ flexShrink: 0 }}
        />
    );
};

export default Icon;
