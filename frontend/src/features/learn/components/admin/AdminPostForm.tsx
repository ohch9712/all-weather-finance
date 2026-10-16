"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CircleAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { applyFieldErrors, toSubmitErrors } from "@/lib/form-errors";
import { cn } from "@/lib/utils";
import { useAdminPost, useSavePost } from "../../hooks";
import { POST_KINDS, POST_LEVELS, type AdminPost, type Draft, type PostKind } from "../../types";
import { KIND_LABEL, LEVEL_LABEL, LIMITS, joinTags } from "../../utils";
import { POST_FORM_FIELDS, postFormSchema, toFormValues, toPostInput, type PostFormInput, type PostFormOutput } from "../../validation";
import { MarkdownBody } from "../MarkdownBody";
import { AdminGate } from "./AdminGate";
import { AiDraftPanel } from "./AiDraftPanel";

function AdminPostForm({ post }: { post?: AdminPost }) {
  const router = useRouter();
  const save = useSavePost();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PostFormInput, unknown, PostFormOutput>({
    resolver: zodResolver(postFormSchema),
    defaultValues: toFormValues(post),
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const level = useWatch({ control: form.control, name: "level" });
  const bodyMd = useWatch({ control: form.control, name: "bodyMd" });
  const aiAssisted = useWatch({ control: form.control, name: "aiAssisted" });

  function changeKind(next: PostKind) {
    form.setValue("kind", next, { shouldDirty: true });
    form.clearErrors(["term", "videoUrl"]);
  }

  function applyDraft(draft: Draft) {
    const options = { shouldDirty: true, shouldValidate: true } as const;
    form.setValue("title", draft.title, options);
    form.setValue("summary", draft.summary, options);
    form.setValue("bodyMd", draft.bodyMd, options);
    form.setValue("tags", joinTags(draft.tags), options);
    if (form.getValues("kind") === "glossary" && draft.term) form.setValue("term", draft.term, options);
    form.setValue("aiAssisted", true, { shouldDirty: true });
  }

  async function onSubmit(values: PostFormOutput) {
    setFormError(null);
    try {
      await save.mutateAsync({ id: post?.id, input: toPostInput(values) });
      toast.success(post ? "게시물을 수정했어요." : "게시물을 만들었어요.");
      router.push("/admin/learn");
    } catch (error) {
      const result = toSubmitErrors(error, POST_FORM_FIELDS);
      applyFieldErrors(form.setError, result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <div className="space-y-6">
      <AiDraftPanel kind={kind} level={level} onDraft={applyDraft} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
          {formError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium" id="post-kind-label">
              종류
            </p>
            <div
              role="radiogroup"
              aria-labelledby="post-kind-label"
              className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:max-w-sm"
            >
              {POST_KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => changeKind(value)}
                  className={cn(
                    "h-8 rounded-md text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    kind === value && "bg-background text-foreground shadow-sm",
                  )}
                >
                  {KIND_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>제목</FormLabel>
                <FormControl>
                  <Input maxLength={LIMITS.title} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {kind === "glossary" && (
            <FormField
              control={form.control}
              name="term"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>용어</FormLabel>
                  <FormControl>
                    <Input maxLength={LIMITS.term} placeholder="예: PER" {...field} />
                  </FormControl>
                  <FormDescription>용어 사전에 보이는 이름이에요. 용어끼리 겹칠 수 없어요.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {kind === "video" && (
            <FormField
              control={form.control}
              name="videoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>YouTube 링크</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      inputMode="url"
                      maxLength={LIMITS.videoUrl}
                      placeholder="https://www.youtube.com/watch?v=…"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>youtube.com/watch, youtu.be, youtube.com/shorts 링크만 받아요.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="summary"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{kind === "glossary" ? "한 줄 정의" : "요약"}</FormLabel>
                <FormControl>
                  <Input maxLength={LIMITS.summary} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>슬러그(주소)</FormLabel>
                  <FormControl>
                    <Input maxLength={LIMITS.slug} autoCapitalize="none" placeholder="예: per" {...field} />
                  </FormControl>
                  <FormDescription>영문 소문자·숫자·하이픈. 비우면 자동으로 만들어요.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>난이도</FormLabel>
                  <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger ref={field.ref} onBlur={field.onBlur} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {POST_LEVELS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {LEVEL_LABEL[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="tags"
            render={({ field }) => (
              <FormItem>
                <FormLabel>태그</FormLabel>
                <FormControl>
                  <Input placeholder="예: 지표, 가치평가" {...field} />
                </FormControl>
                <FormDescription>쉼표로 나눠요. 최대 {LIMITS.tags}개, 하나에 {LIMITS.tag}자까지예요.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="bodyMd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>본문(Markdown)</FormLabel>
                <Tabs defaultValue="write">
                  <TabsList>
                    <TabsTrigger value="write">작성</TabsTrigger>
                    <TabsTrigger value="preview">미리보기</TabsTrigger>
                  </TabsList>
                  <TabsContent value="write">
                    <FormControl>
                      <Textarea rows={16} maxLength={LIMITS.body} className="font-mono text-sm" {...field} />
                    </FormControl>
                  </TabsContent>
                  <TabsContent value="preview">
                    <div className="min-h-40 rounded-lg border p-4">
                      {bodyMd.trim() ? (
                        <MarkdownBody>{bodyMd}</MarkdownBody>
                      ) : (
                        <p className="text-sm text-muted-foreground">미리 볼 내용이 없어요.</p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
                <FormDescription>
                  {bodyMd.length.toLocaleString("ko-KR")} / {LIMITS.body.toLocaleString("ko-KR")}자. HTML 태그는 화면에 그리지 않아요.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <FormField
              control={form.control}
              name="published"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel>공개</FormLabel>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="aiAssisted"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="flex items-center gap-1">
                    {aiAssisted && <Sparkles className="size-3.5" aria-hidden="true" />}
                    AI 도움으로 작성
                  </FormLabel>
                </FormItem>
              )}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin/learn">취소</Link>
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {post ? "수정 저장" : "만들기"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function BackToList() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link href="/admin/learn">
        <ArrowLeft aria-hidden="true" />
        콘텐츠 목록
      </Link>
    </Button>
  );
}

function EditPostContent({ id }: { id: string }) {
  const { data: post, isPending, isError, error, refetch } = useAdminPost(id);
  if (isPending) return <LoadingState rows={6} />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  return <AdminPostForm key={post.id} post={post} />;
}

/** `/admin/learn/new`(id 없음), `/admin/learn/[id]/edit` */
export function AdminPostEditor({ id }: { id?: string }) {
  return (
    <AdminGate>
      <div className="mx-auto max-w-3xl space-y-2">
        <BackToList />
        <PageHeader
          title={id ? "게시물 수정" : "새 게시물"}
          description="종류에 따라 용어·영상 링크 칸이 바뀌어요. AI 초안은 저장하기 전에 꼭 검토하세요."
        />
        {id ? <EditPostContent id={id} /> : <AdminPostForm />}
      </div>
    </AdminGate>
  );
}
