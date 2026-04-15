import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { BlackboardAPI } from './blackboard';
import { Course, ContentItem, SyncProgress, SyncResult, SyncResultCourse } from '../types.d';

interface FileToDownload {
    courseId: string;
    courseName: string;
    contentId: string;
    attachmentId: string;
    fileName: string;
    relativePath: string;
}

export class DownloadManager extends EventEmitter {
    private api: BlackboardAPI;
    private syncDir: string;
    private courseAliases: Record<string, string>;
    private concurrency = 3;
    private aborted = false;

    constructor(api: BlackboardAPI, syncDir: string, courseAliases: Record<string, string> = {}) {
        super();
        this.api = api;
        this.syncDir = syncDir;
        this.courseAliases = courseAliases;
    }

    abort(): void {
        this.aborted = true;
    }

    async syncAll(courses: Course[]): Promise<SyncResult> {
        this.aborted = false;
        const files: FileToDownload[] = [];
        const startTime = Date.now();

        this.emitProgress({ phase: 'scanning', current: 0, total: courses.length });

        for (let i = 0; i < courses.length; i++) {
            if (this.aborted) return { totalDownloaded: 0, totalScanned: 0, courses: [], duration: 0 };

            const course = courses[i];
            this.emitProgress({
                phase: 'scanning',
                current: i + 1,
                total: courses.length,
                currentFile: course.name,
            });

            try {
                const contents = await this.api.getContents(course.id);
                const aliasOrName = this.courseAliases[course.id] || course.name;
                const courseFolderName = this.sanitizePath(aliasOrName);
                await this.scanContents(course, contents, courseFolderName, files);
            } catch (err) {
                console.error(`Error scanning course ${course.name}:`, err);
            }
        }

        const toDownload = files.filter((f) => {
            const fullPath = path.join(this.syncDir, f.relativePath);
            if (!this.isInsideSyncDir(fullPath)) return false;
            return !fs.existsSync(fullPath);
        });

        if (toDownload.length === 0) {
            this.emitProgress({ phase: 'complete', current: 0, total: 0 });
            return {
                totalDownloaded: 0,
                totalScanned: files.length,
                courses: [],
                duration: Math.round((Date.now() - startTime) / 1000),
            };
        }

        let downloaded = 0;
        const total = toDownload.length;
        const queue = [...toDownload];
        const downloadedFiles: FileToDownload[] = [];

        const workerCount = Math.min(this.concurrency, queue.length);
        const workers = Array(workerCount)
            .fill(null)
            .map(async () => {
                while (queue.length > 0 && !this.aborted) {
                    const file = queue.shift()!;
                    try {
                        const { data } = await this.api.downloadFile(
                            file.courseId,
                            file.contentId,
                            file.attachmentId
                        );

                        if (this.aborted) break;

                        const fullPath = path.join(this.syncDir, file.relativePath);
                        if (!this.isInsideSyncDir(fullPath)) continue;
                        const dir = path.dirname(fullPath);
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(fullPath, data);

                        downloadedFiles.push(file);
                        downloaded++;

                        this.emitProgress({
                            phase: 'downloading',
                            current: downloaded,
                            total,
                            currentFile: file.fileName,
                        });
                    } catch (err) {
                        console.error(`Failed to download ${file.fileName}:`, err);
                    }
                }
            });

        await Promise.all(workers);

        const courseMap = new Map<string, SyncResultCourse>();
        for (const file of downloadedFiles) {
            const key = file.courseId;
            if (!courseMap.has(key)) {
                courseMap.set(key, { courseName: file.courseName, files: [] });
            }
            courseMap.get(key)!.files.push(file.fileName);
        }

        this.emitProgress({ phase: 'complete', current: downloaded, total });

        return {
            totalDownloaded: downloaded,
            totalScanned: files.length,
            courses: Array.from(courseMap.values()),
            duration: Math.round((Date.now() - startTime) / 1000),
        };
    }

    private async scanContents(
        course: Course,
        contents: ContentItem[],
        basePath: string,
        files: FileToDownload[],
        visited: Set<string> = new Set(),
        depth = 0
    ): Promise<void> {
        if (depth > 20) return;

        for (const item of contents) {
            if (this.aborted) return;

            try {
                const attachments = await this.api.getAttachments(course.id, item.id);
                for (const att of attachments) {
                    files.push({
                        courseId: course.id,
                        courseName: course.name,
                        contentId: item.id,
                        attachmentId: att.id,
                        fileName: att.fileName,
                        relativePath: path.join(basePath, this.sanitizePath(att.fileName)),
                    });
                }
            } catch (err) {
                console.error(`Error fetching attachments for "${item.title}" in ${course.name}:`, err);
            }

            if (item.hasChildren && !visited.has(item.id)) {
                visited.add(item.id);
                try {
                    const children = await this.api.getChildren(course.id, item.id);
                    const folderPath = path.join(basePath, this.sanitizePath(item.title));
                    await this.scanContents(course, children, folderPath, files, visited, depth + 1);
                } catch (err) {
                    console.error(`Error fetching children for "${item.title}" in ${course.name}:`, err);
                }
            }
        }
    }

    private sanitizePath(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\.+$/, '_');
    }

    private isInsideSyncDir(fullPath: string): boolean {
        const resolved = path.resolve(fullPath);
        const base = path.resolve(this.syncDir);
        return resolved === base || resolved.startsWith(base + path.sep);
    }

    private emitProgress(progress: SyncProgress): void {
        this.emit('progress', progress);
    }
}
