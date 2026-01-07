export interface GitRepository {
  id: string;
  name: string;
  url: string;
}

export interface GitRef {
  name: string;
  objectId: string;
}

export interface GitCommit {
  commitId: string;
  comment: string;
  author: {
    name: string;
    date: string;
  };
  changeCounts?: any;
}

export interface HuResult {
  id: string;
  commits?: GitCommit[]; // Lo hacemos opcional o lo quitamos
  prs?: AzurePullRequest[]; // Nueva propiedad
}

// ... tus interfaces anteriores (GitRepository, etc.)

export interface AzurePullRequest {
  pullRequestId: number;
  title: string;
  description: string; // 👈 Aquí está la información que buscas
  sourceRefName: string; // Rama origen del PR
  targetRefName: string; // Rama destino del PR
  creationDate: string;
  createdBy: {
    displayName: string;
  };
}

export interface PrQueryResponse {
  results: {
    [key: string]: AzurePullRequest[]; // La clave es el CommitId
  }[];
}