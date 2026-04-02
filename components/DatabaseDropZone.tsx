import React, { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface DatabaseDropZoneProps {
  onFilePath: (filePath: string) => Promise<void>;
  onBrowse: () => Promise<void>;
}

const getPathFromDrop = (event: React.DragEvent<HTMLDivElement>): string | null => {
  const file = event.dataTransfer.files?.[0] as File & { path?: string };
  if (!file) return null;

  const rawPath = file.path;
  if (!rawPath || typeof rawPath !== 'string') {
    return null;
  }

  return rawPath;
};

export const DatabaseDropZone: React.FC<DatabaseDropZoneProps> = ({ onFilePath, onBrowse }) => {
  const [dragActive, setDragActive] = useState(false);

  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);

      const filePath = getPathFromDrop(event);
      if (!filePath) {
        return;
      }

      await onFilePath(filePath);
    },
    [onFilePath]
  );

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragActive(false);
      }}
      onDrop={onDrop}
      className={[
        'rounded-xl border-2 border-dashed p-8 text-center transition-all',
        dragActive ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-green-500 hover:bg-green-50',
      ].join(' ')}
    >
      <UploadCloud className="mx-auto mb-3 h-8 w-8 text-gray-500" />
      <p className="text-sm font-semibold text-gray-700">Arraste o arquivo msgstore.db aqui</p>
      <p className="mt-1 text-xs text-gray-500">ou</p>
      <button
        type="button"
        onClick={onBrowse}
        className="mt-3 inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
      >
        Selecionar arquivo
      </button>
    </div>
  );
};
