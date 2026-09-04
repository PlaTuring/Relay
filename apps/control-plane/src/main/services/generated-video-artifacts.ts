const RESULT_ID_BODY = "[a-z0-9][a-z0-9-]{7,127}";
const TEMPORARY_ID = "[a-z0-9]{8,128}";

export const GENERATED_VIDEO_INDEX_FILE_NAME = "generated-videos.v1.json";

const GENERATED_VIDEO_INDEX_TEMPORARY = new RegExp(
  `^\\.${GENERATED_VIDEO_INDEX_FILE_NAME.replaceAll(".", "\\.")}\\.${TEMPORARY_ID}\\.tmp$`,
  "u"
);
const GENERATED_VIDEO_POSTER = new RegExp(
  `^generated-result-${RESULT_ID_BODY}-[a-f0-9]{16}\\.png$`,
  "u"
);
const GENERATED_VIDEO_POSTER_TEMPORARY = new RegExp(
  `^\\.generated-result-${RESULT_ID_BODY}-${TEMPORARY_ID}\\.tmp$`,
  "u"
);

/**
 * Machine-local discovery evidence. These names are reserved for the
 * generated-video service and must never be inherited by a project clone.
 */
export function isGeneratedVideoLocalIndexArtifactName(fileName: string): boolean {
  return fileName === GENERATED_VIDEO_INDEX_FILE_NAME
    || GENERATED_VIDEO_INDEX_TEMPORARY.test(fileName);
}

/**
 * Disposable poster cache owned by an external generated-video result. Both
 * the committed PNG and a crash-left temporary are excluded from clones and
 * portable project bundles.
 */
export function isGeneratedVideoPosterCacheArtifactName(fileName: string): boolean {
  return GENERATED_VIDEO_POSTER.test(fileName)
    || GENERATED_VIDEO_POSTER_TEMPORARY.test(fileName);
}
