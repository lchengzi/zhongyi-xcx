import type { Account } from '../shared/contracts.js';
import type { CatalogRepository } from './database.js';
import type { AuthRepository } from './auth.js';
import type { WorkflowRepository } from './workflow.js';
import type { AssistantRepository } from './assistant-repository.js';
import type { PublicationRepository } from './publication.js';
import type { PhotoNoteStore } from './photo-note-service.js';
import type { PhotoSubmissionStore } from './photo-submission-service.js';
import type { PhotoRightsStore } from './photo-rights-service.js';
import type { PhotoProfessionalStore } from './photo-professional-policy.js';

export interface WriteAuthority { account: Account; token: string }
type AsyncCompatible<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : never
};
export type CatalogStore = AsyncCompatible<Pick<CatalogRepository,
  'list' | 'ingredient' | 'publicSnapshot' | 'note' | 'saveNote' | 'summary' | 'events'>>;
export type AuthStore = AsyncCompatible<Pick<AuthRepository,
  'users' | 'events' | 'createUser' | 'updateUser' | 'login' | 'session' | 'logout'>>;
export type WorkflowStore = AsyncCompatible<Pick<WorkflowRepository,
  'sources' | 'source' | 'saveSource' | 'revision' | 'draft' | 'detail' | 'saveDraft' | 'submit' | 'tasks' | 'task' | 'decide' | 'events' |
  'qualificationHistory' | 'professionalDetail' | 'saveQualification' | 'recordProfessionalReview' | 'sourceCheck' | 'saveSourceCheck' | 'publicationPreflight'>>;
export type AssistantStore = AsyncCompatible<Pick<AssistantRepository, 'authorize' | 'excerpts' | 'excerpt' | 'saveExcerpt' | 'record' | 'events' | 'permission' | 'quota' | 'reserve' | 'complete'>>;
export type PublicationStore = AsyncCompatible<Pick<PublicationRepository,
  'workspace' | 'snapshot' | 'createSnapshot' | 'approve' | 'action' | 'control' | 'controlHistory' | 'published'>>;
export interface RepositoryBundle {
  engine: 'sqlite' | 'postgres';
  catalog: CatalogStore;
  auth: AuthStore;
  workflow: WorkflowStore;
  assistant: AssistantStore;
  publication: PublicationStore;
  photoNotes: PhotoNoteStore;
  photoSubmissions: PhotoSubmissionStore;
  photoRights: PhotoRightsStore;
  photoProfessional: PhotoProfessionalStore;
  close(): void | Promise<void>;
}
