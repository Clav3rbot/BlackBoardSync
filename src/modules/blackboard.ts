import axios, { AxiosInstance } from 'axios';
import { UserInfo, Course, ContentItem, Attachment } from '../types.d';

const BASE_URL = 'https://blackboard.unibocconi.it';
const API_BASE = `${BASE_URL}/learn/api/public/v1`;

export class BlackboardAPI {
    private client: AxiosInstance;

    constructor(cookies: string[]) {
        this.client = axios.create({
            baseURL: API_BASE,
            headers: {
                Cookie: cookies.join('; '),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlackBoardSync/1.0',
            },
            timeout: 30000,
        });
    }

    updateCookies(cookies: string[]): void {
        this.client.defaults.headers['Cookie'] = cookies.join('; ');
    }

    async getCurrentUser(): Promise<UserInfo> {
        const { data } = await this.client.get('/users/me');
        return data;
    }

    async getCourses(userId: string): Promise<Course[]> {
        const courses: Course[] = [];
        let url = `/users/${userId}/courses?limit=100&fields=courseId,course.name,course.id,course.termId`;

        while (url) {
            const { data } = await this.client.get(url);

            if (data.results) {
                for (const membership of data.results) {
                    if (membership.course) {
                        courses.push({
                            id: membership.course.id,
                            courseId: membership.courseId,
                            name: membership.course.name || membership.courseId,
                            term: membership.course.termId
                                ? { id: membership.course.termId, name: '' }
                                : undefined,
                        });
                    }
                }
            }

            url = data.paging?.nextPage || null;
        }

        const termIds = [...new Set(courses.filter(c => c.term).map(c => c.term!.id))];
        const termNames: Record<string, string> = {};
        for (const termId of termIds) {
            try {
                const { data } = await this.client.get(`/terms/${termId}`);
                termNames[termId] = data.name || termId;
            } catch {
                termNames[termId] = termId;
            }
        }
        for (const course of courses) {
            if (course.term && termNames[course.term.id]) {
                course.term.name = termNames[course.term.id];
            }
        }

        const EXCLUDED_ROLES = ['Student', 'Guest', 'CourseBuilder', 'BbSpectator', 'TeachingAssistant', 'Grader'];
        const batchSize = 5;
        for (let i = 0; i < courses.length; i += batchSize) {
            const batch = courses.slice(i, i + batchSize);
            await Promise.all(batch.map(async (course) => {
                try {
                    const { data } = await this.client.get(
                        `/courses/${course.id}/users?limit=200&fields=userId,courseRoleId`
                    );
                    const results = data.results || [];
                    const instructorIds = results
                        .filter((m: any) => m.courseRoleId && !EXCLUDED_ROLES.includes(m.courseRoleId))
                        .map((m: any) => m.userId)
                        .filter(Boolean);

                    if (instructorIds.length === 0) return;

                    const names: string[] = [];
                    for (const uid of instructorIds) {
                        try {
                            const { data: m } = await this.client.get(
                                `/courses/${course.id}/users/${uid}?expand=user`
                            );
                            const n = m?.user?.name;
                            if (n) {
                                const fullName = `${n.given || ''} ${n.family || ''}`.trim();
                                if (fullName) names.push(fullName);
                            }
                        } catch {}
                    }

                    if (names.length > 0) {
                        course.instructor = [...new Set(names)].join(', ');
                    }
                } catch {}
            }));
        }

        return courses;
    }

    async getContents(courseId: string): Promise<ContentItem[]> {
        try {
            const { data } = await this.client.get(`/courses/${courseId}/contents`);
            return data.results || [];
        } catch {
            return [];
        }
    }

    async getChildren(courseId: string, contentId: string): Promise<ContentItem[]> {
        try {
            const { data } = await this.client.get(
                `/courses/${courseId}/contents/${contentId}/children`
            );
            return data.results || [];
        } catch {
            return [];
        }
    }

    async getAttachments(courseId: string, contentId: string): Promise<Attachment[]> {
        try {
            const { data } = await this.client.get(
                `/courses/${courseId}/contents/${contentId}/attachments`
            );
            return data.results || [];
        } catch {
            return [];
        }
    }

    async downloadFile(
        courseId: string,
        contentId: string,
        attachmentId: string
    ): Promise<{ data: Buffer; fileName: string }> {
        const response = await this.client.get(
            `/courses/${courseId}/contents/${contentId}/attachments/${attachmentId}/download`,
            { responseType: 'arraybuffer', maxRedirects: 5 }
        );

        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        const fileName = match ? match[1].replace(/['"]/g, '') : 'unknown';

        return { data: Buffer.from(response.data), fileName };
    }
}
