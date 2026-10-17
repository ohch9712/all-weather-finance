"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getErrorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAdminPosts, useDeletePost, useSetPublished } from "../../hooks";
import { POST_KINDS, type AdminPost, type PostKind } from "../../types";
import { ADMIN_PAGE_SIZE, KIND_LABEL } from "../../utils";
import { KindIcon } from "../PostBits";
import { AdminGate } from "./AdminGate";

const ALL = "all";
type PublishedFilter = "all" | "true" | "false";

function PublishedSwitch({ post }: { post: AdminPost }) {
  const setPublished = useSetPublished();
  return (
    <Switch
      checked={post.published}
      disabled={setPublished.isPending}
      aria-label={`${post.title} 공개`}
      onCheckedChange={(published) =>
        setPublished.mutate(
          { id: post.id, published },
          {
            onSuccess: () => toast.success(published ? "공개했어요." : "비공개로 돌렸어요."),
            onError: (error) => toast.error(getErrorMessage(error)),
          },
        )
      }
    />
  );
}

function DeleteButton({ post }: { post: AdminPost }) {
  const deletePost = useDeletePost();
  return (
    <ConfirmDialog
      title="게시물을 삭제할까요?"
      description={`"${post.title}"을(를) 지우면 사용자의 북마크·읽음 기록도 함께 지워지고 되돌릴 수 없어요.`}
      confirmLabel="삭제"
      destructive
      onConfirm={async () => {
        try {
          await deletePost.mutateAsync(post.id);
          toast.success("게시물을 삭제했어요.");
        } catch (error) {
          toast.error(getErrorMessage(error));
          throw error;
        }
      }}
      trigger={
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${post.title} 삭제`}>
          <Trash2 aria-hidden="true" />
        </Button>
      }
    />
  );
}

function AdminPostsContent() {
  const [kind, setKind] = useState<PostKind | null>(null);
  const [published, setPublished] = useState<PublishedFilter>(ALL);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch } = useAdminPosts({
    kind,
    published: published === ALL ? null : published === "true",
    q,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function submit(event: FormEvent) {
    event.preventDefault();
    setQ(query.trim());
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="학습 콘텐츠 관리"
        description="글·영상·용어를 만들고 공개 여부를 정해요."
        actions={
          <Button asChild>
            <Link href="/admin/learn/new">
              <Plus aria-hidden="true" />
              새로 만들기
            </Link>
          </Button>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select
            value={kind ?? ALL}
            onValueChange={(value) => {
              setKind(value === ALL ? null : (value as PostKind));
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="종류" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>모든 종류</SelectItem>
              {POST_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {KIND_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={published}
            onValueChange={(value) => {
              setPublished(value as PublishedFilter);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="공개 여부" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체</SelectItem>
              <SelectItem value="true">공개</SelectItem>
              <SelectItem value="false">비공개</SelectItem>
            </SelectContent>
          </Select>
          <form role="search" onSubmit={submit} className="flex min-w-0 flex-1 basis-56 gap-2">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="제목·슬러그·내용"
              aria-label="게시물 검색"
              maxLength={100}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline" size="icon" aria-label="검색">
              <Search aria-hidden="true" />
            </Button>
          </form>
        </div>

        {isPending ? (
          <LoadingState rows={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState title="게시물이 없어요" description="새로 만들기로 첫 게시물을 올려 보세요." />
        ) : (
          <>
            <Table aria-label="게시물 목록">
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden w-16 sm:table-cell">종류</TableHead>
                  <TableHead>제목</TableHead>
                  <TableHead className="w-14">공개</TableHead>
                  <TableHead className="hidden w-36 md:table-cell">수정일</TableHead>
                  <TableHead className="w-20 text-right">
                    <span className="sr-only">관리</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="hidden sm:table-cell">{KIND_LABEL[post.kind]}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex min-w-0 items-start gap-1.5">
                        <KindIcon kind={post.kind} className="mt-0.5 text-muted-foreground sm:hidden" />
                        <div className="min-w-0">
                          <p className="font-medium break-words">{post.title}</p>
                          <p className="text-xs text-muted-foreground break-all">{post.slug}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <PublishedSwitch post={post} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(post.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" asChild>
                          <Link href={`/admin/learn/${post.id}/edit`} aria-label={`${post.title} 수정`}>
                            <Pencil aria-hidden="true" />
                          </Link>
                        </Button>
                        <DeleteButton post={post} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <nav aria-label="쪽 이동" className="flex items-center justify-center gap-3">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft aria-hidden="true" />
                  이전
                </Button>
                <span className="text-sm tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  다음
                  <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** `/admin/learn`: 게시물 표(종류, 제목, 공개 스위치, 수정일), 새로 만들기·수정·삭제 */
export function AdminPostsPage() {
  return (
    <AdminGate>
      <AdminPostsContent />
    </AdminGate>
  );
}
