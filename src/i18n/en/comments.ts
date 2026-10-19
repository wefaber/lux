import type { comments as es } from "../es/comments";
import type { Translation } from "../types";

export const comments: Translation<typeof es> = {
  "comments.title": "Comments ({count})",
  "comments.label": "Comments",
  "comments.loadFailed": "Could not load the comments: {error}",
  "comments.empty": "There are no comments yet. Use this space for questions or updates.",
  "comments.you": "You",
  "comments.write": "Write a comment",
  "comments.placeholder": "Write a comment...",
  "comments.hint": "Ctrl + Enter to send",
  "comments.sending": "Sending...",
  "comments.send": "Comment",
  "comments.sendFailed": "Could not send the comment",
};
