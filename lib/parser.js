/**
 * Recursively scans any JSON object to find author name and profile link.
 */
function extractAuthor(node) {
  if (!node || typeof node !== 'object') return { name: "Unknown Author", url: null };

  // Helper function to check if an object is a valid actor
  const isValidActor = (a) => a && typeof a === 'object' && (a.name || a.text);

  // Deep recursive search for any actor object
  let foundActor = null;

  const traverse = (obj) => {
    if (foundActor || !obj || typeof obj !== 'object') return;

    // Check direct properties or array items
    if (Array.isArray(obj.actors) && isValidActor(obj.actors[0])) {
      foundActor = obj.actors[0];
      return;
    }
    if (isValidActor(obj.owning_profile)) {
      foundActor = obj.owning_profile;
      return;
    }
    if (isValidActor(obj.actor)) {
      foundActor = obj.actor;
      return;
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null && key !== 'feedback') {
        traverse(obj[key]);
      }
    }
  };

  traverse(node);

  if (foundActor) {
    return {
      name: foundActor.name || foundActor.text || "Unknown Author",
      url: foundActor.url || foundActor.permalink_url || null
    };
  }

  return { name: "Unknown Author", url: null };
}

/**
 * Recursively retrieves post body text or message runs.
 */
function extractText(node) {
  if (!node || typeof node !== 'object') return "";

  let foundText = "";

  const traverse = (obj) => {
    if (foundText || !obj || typeof obj !== 'object') return;

    // Standard message object
    if (obj.message && typeof obj.message.text === 'string' && obj.message.text.trim()) {
      foundText = obj.message.text;
      return;
    }

    // Direct text string under story/content nodes
    if (typeof obj.text === 'string' && obj.__typename === 'TextWithEntities') {
      foundText = obj.text;
      return;
    }

    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        traverse(obj[k]);
      }
    }
  };

  traverse(node);
  return foundText;
}

/**
 * Extract image URIs from media attachments.
 */
function extractImages(node) {
  const images = new Set();

  const traverse = (obj) => {
    if (!obj || typeof obj !== 'object') return;

    if (obj.image && typeof obj.image.uri === 'string') {
      images.add(obj.image.uri);
    }
    if (obj.viewer_image && typeof obj.viewer_image.uri === 'string') {
      images.add(obj.viewer_image.uri);
    }

    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        traverse(obj[k]);
      }
    }
  };

  traverse(node);
  return Array.from(images);
}

/**
 * Main parser entry point for raw GraphQL responses.
 */
export function parseGraphQLPayload(rawBody) {
  const posts = [];
  if (!rawBody || typeof rawBody !== 'string') return posts;

  const lines = rawBody.split('\n');
  const seen = new Set();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      findStoryNodes(payload, posts, seen);
    } catch (e) {
      // Ignore non-JSON lines
    }
  }

  return posts;
}

/**
 * Locates valid post nodes inside arbitrary GraphQL responses.
 */
function findStoryNodes(obj, results, seen) {
  if (!obj || typeof obj !== 'object') return;

  // Identify GraphQL Story nodes more flexibly
  const isGraphQLStory = obj.__typename === 'Story' || obj.__typename === 'CometStory';
  const hasStoryIdentifiers = (obj.post_id || obj.id || obj.graphql_token) &&
                               (obj.message || obj.comet_sections || obj.attachments || obj.actors);

  if (isGraphQLStory || hasStoryIdentifiers) {
    const postId = obj.post_id || obj.id;

    if (postId && !seen.has(postId)) {
      const author = extractAuthor(obj);
      const text = extractText(obj);
      const images = extractImages(obj);

      // Verify node is an actual post with content rather than an empty metadata node
      if (text || images.length > 0 || author.name !== "Unknown Author") {
        seen.add(postId);

        results.push({
          postId,
          permalinkUrl: obj.permalink_url || obj.url || null,
          timestamp: obj.creation_time || Math.floor(Date.now() / 1000),
          formattedDate: new Date((obj.creation_time || Math.floor(Date.now() / 1000)) * 1000).toLocaleString(),
          author,
          group: {
            id: obj.to?.id || null,
            name: obj.to?.name || "Facebook Feed"
          },
          text,
          images
        });
        return; // Don't recurse deeper into the same story node once processed
      }
    }
  }

  // Recurse into child properties
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      findStoryNodes(obj[key], results, seen);
    }
  }
}
