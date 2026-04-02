import React from 'react';
import { AlertCircle, Database, Folder } from 'lucide-react';
import { DatabaseDropZone } from './DatabaseDropZone';

interface FileLoaderScreenProps {
  error: string | null;
  mediaRootPath: string | null;
  onSelectMediaFolder: () => Promise<void>;
  onDropFilePath: (filePath: string) => Promise<void>;
  onDropError: (message: string) => void;
  onBrowseFile: () => Promise<void>;
}

export const FileLoaderScreen: React.FC<FileLoaderScreenProps> = ({
  error,
  mediaRootPath,
  onSelectMediaFolder,
  onDropFilePath,
  onDropError,
  onBrowseFile,
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1ea463] to-[#148575] p-4">
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center">
        <div className="w-full rounded-2xl bg-white p-8 shadow-2xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-700">
            <Database size={36} />
          </div>

          <h1 className="text-center text-2xl font-bold text-gray-900">WA Viewer Pro</h1>
          <p className="mt-2 text-center text-sm text-gray-500">
            Processamento local com Electron. Abra um msgstore.db para começar.
          </p>

          <div className="mt-6">
            <DatabaseDropZone onFilePath={onDropFilePath} onBrowse={onBrowseFile} onDropError={onDropError} />
          </div>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={onSelectMediaFolder}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
            >
              <Folder size={16} />
              Selecionar pasta de mídias (opcional)
            </button>
          </div>

          {mediaRootPath && (
            <p className="mt-2 break-all rounded-md bg-gray-50 p-2 text-center text-xs text-gray-500">{mediaRootPath}</p>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
