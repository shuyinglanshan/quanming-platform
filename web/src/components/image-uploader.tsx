import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';

export type LocalFile = { file: File; url: string; id: string };

const MAX_SIZE = 8 * 1024 * 1024;

export function ImageUploader({
  files,
  setFiles,
  max = 6,
  hint,
  label,
  className,
}: {
  files: LocalFile[];
  setFiles: React.Dispatch<React.SetStateAction<LocalFile[]>>;
  max?: number;
  hint?: string;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of incoming) {
          if (next.length >= max) {
            toast.error(`最多上传 ${max} 张图片`);
            break;
          }
          if (!f.type.startsWith('image/')) {
            toast.error(`${f.name} 不是图片文件`);
            continue;
          }
          if (f.size > MAX_SIZE) {
            toast.error(`${f.name} 超过 8MB`);
            continue;
          }
          next.push({ file: f, url: URL.createObjectURL(f), id: `${f.name}-${f.size}-${Math.random()}` });
        }
        return next;
      });
    },
    [max, setFiles],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-7 text-center transition-all',
          dragging
            ? 'border-violet-300/60 bg-violet-400/10'
            : 'border-white/15 bg-white/[0.03] hover:border-violet-300/40 hover:bg-white/[0.055]',
        )}
      >
        <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/25 to-cyan-400/15">
          <UploadCloud className="size-4.5 text-violet-200" />
        </div>
        <div className="text-[12.5px] text-slate-200">{label || '点击上传，或将图片拖拽到这里'}</div>
        <div className="text-[11px] text-slate-500">
          {hint || `支持 JPG / PNG / WEBP / GIF，单张 ≤ 8MB，最多 ${max} 张`}（已选 {files.length} 张）
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {files.map((f) => (
            <div key={f.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
              <img src={f.url} alt={f.file.name} className="h-24 w-full object-cover" />
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="truncate text-[10.5px] text-slate-400">{f.file.name}</span>
                <span className="shrink-0 text-[10px] text-slate-600">{formatBytes(f.file.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="absolute top-1.5 right-1.5 rounded-lg bg-black/60 p-1 text-slate-300 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-rose-500/80 hover:text-white"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          {files.length < max && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-[7.5rem] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 text-slate-500 transition hover:border-violet-300/40 hover:text-violet-200"
            >
              <ImagePlus className="size-5" />
              <span className="text-[11px]">继续添加</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
