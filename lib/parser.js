/**
 * Main parser entry point for raw GraphQL payload chunks and SSR scripts.
 */
 export function parseGraphQLPayload(rawBody) {
   const posts = [];
   if (!rawBody || typeof rawBody !== 'string') return posts;

   const cleanedBody = rawBody.replace(/^for\s*\(\s*;;\s*\);\s*/, '');
   const lines = cleanedBody.split('\n');

   for (const line of lines) {
     const trimmed = line.trim();
     if (!trimmed) continue;

     try {
       const payload = JSON.parse(trimmed);

       // Separate Avatar (index 0) from Post Media (index 1+)
       let profilePic = null;
       const prefetchUris = [];

       if (payload.extensions && Array.isArray(payload.extensions.prefetch_uris_v2)) {
         payload.extensions.prefetch_uris_v2.forEach((item, index) => {
           if (item && item.uri) {
             if (index === 0) {
               profilePic = item.uri; // [0] is the profile picture
             } else {
               prefetchUris.push(item.uri); // The rest is post media
             }
           }
         });
       }

       const chunkPosts = [];
       const seenInChunk = new Set();
       findStoryNodes(payload, chunkPosts, seenInChunk);

       // Attach the Avatar and Media to the posts found in this chunk
       if (profilePic || prefetchUris.length > 0) {
         chunkPosts.forEach(post => {
           if (profilePic && !post.author.profilePic) {
             post.author.profilePic = profilePic;
           }
           if (prefetchUris.length > 0) {
             post.images = Array.from(new Set([...post.images, ...prefetchUris]));
           }
         });
       }

       posts.push(...chunkPosts);
     } catch (e) {
       // Skip non-JSON lines
     }
   }

   return posts;
 }

 function findStoryNodes(obj, results, seen) {
   if (!obj || typeof obj !== 'object') return;

   const isGraphQLStory = obj.__typename === 'Story' || obj.__typename === 'CometStory';
   const hasStoryIdentifiers = (obj.post_id || obj.id) &&
                                (obj.message || obj.comet_sections || obj.attachments || obj.actors);

   if (isGraphQLStory || hasStoryIdentifiers) {
     const postId = obj.post_id || obj.id;

     if (postId && !seen.has(postId)) {
       const author = extractAuthor(obj);
       const group = extractGroup(obj);
       const text = extractText(obj);
       const images = extractImages(obj);

       if (text || images.length > 0 || author.name !== "Unknown Author") {
         seen.add(postId);

         results.push({
           postId: String(postId),
           permalinkUrl: obj.permalink_url || obj.url || null, // Captures Post URL
           timestamp: obj.creation_time || Math.floor(Date.now() / 1000),
           formattedDate: new Date((obj.creation_time || Math.floor(Date.now() / 1000)) * 1000).toLocaleString(),
           author,
           group,
           text,
           images
         });
         return;
       }
     }
   }

   for (const key of Object.keys(obj)) {
     if (typeof obj[key] === 'object' && obj[key] !== null) {
       findStoryNodes(obj[key], results, seen);
     }
   }
 }

 function extractAuthor(node) {
   if (!node || typeof node !== 'object') return { name: "Unknown Author", url: null, profilePic: null };
   let foundActor = null;
   const traverse = (obj) => {
     if (foundActor || !obj || typeof obj !== 'object') return;
     if (Array.isArray(obj.actors) && obj.actors[0] && typeof obj.actors[0] === 'object') {
       foundActor = obj.actors[0];
       return;
     }
     if (obj.actor && typeof obj.actor === 'object' && (obj.actor.name || obj.actor.text)) {
       foundActor = obj.actor;
       return;
     }
     if (obj.owning_profile && typeof obj.owning_profile === 'object') {
       foundActor = obj.owning_profile;
       return;
     }
     for (const key of Object.keys(obj)) {
       if (typeof obj[key] === 'object' && obj[key] !== null && key !== 'feedback') traverse(obj[key]);
     }
   };
   traverse(node);
   if (foundActor) {
     return {
       name: foundActor.name || foundActor.text || "Unknown Author",
       url: foundActor.url || foundActor.permalink_url || null,
       profilePic: null // Will be populated by the outer parser loop
     };
   }
   return { name: "Unknown Author", url: null, profilePic: null };
 }

 function extractGroup(node) {
   if (!node || typeof node !== 'object') return { id: null, name: "Facebook Feed", url: null };
   let groupData = null;
   const traverse = (obj) => {
     if (groupData || !obj || typeof obj !== 'object') return;
     if (obj.to && typeof obj.to === 'object' && (obj.to.name || obj.to.id)) {
       groupData = {
         id: obj.to.id || null,
         name: obj.to.name || "Facebook Group",
         url: obj.to.url || null // Captures Group URL
       };
       return;
     }
     for (const k of Object.keys(obj)) {
       if (typeof obj[k] === 'object' && obj[k] !== null) traverse(obj[k]);
     }
   };
   traverse(node);
   return groupData || { id: null, name: "Facebook Feed", url: null };
 }

 function extractText(node) {
   if (!node || typeof node !== 'object') return "";
   let foundText = "";
   const traverse = (obj) => {
     if (foundText || !obj || typeof obj !== 'object') return;
     if (obj.message && typeof obj.message.text === 'string' && obj.message.text.trim()) {
       foundText = obj.message.text.trim(); return;
     }
     if (obj.attached_story && obj.attached_story.message && typeof obj.attached_story.message.text === 'string') {
       foundText = obj.attached_story.message.text.trim(); return;
     }
     if (typeof obj.text === 'string' && obj.__typename === 'TextWithEntities' && obj.text.trim()) {
       foundText = obj.text.trim(); return;
     }
     for (const k of Object.keys(obj)) {
       if (typeof obj[k] === 'object' && obj[k] !== null) traverse(obj[k]);
     }
   };
   traverse(node);
   return foundText;
 }

 function extractImages(node) {
   const images = new Set();
   const traverse = (obj) => {
     if (!obj || typeof obj !== 'object') return;
     if (obj.image && typeof obj.image.uri === 'string') images.add(obj.image.uri);
     if (obj.photo_image && typeof obj.photo_image.uri === 'string') images.add(obj.photo_image.uri);
     if (obj.viewer_image && typeof obj.viewer_image.uri === 'string') images.add(obj.viewer_image.uri);
     for (const k of Object.keys(obj)) {
       if (typeof obj[k] === 'object' && obj[k] !== null) traverse(obj[k]);
     }
   };
   traverse(node);
   return Array.from(images);
 }
