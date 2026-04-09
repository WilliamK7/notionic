import BLOG from '@/blog.config'
import Layout from '@/layouts/layout'
import { getAllPosts, getPostBlocks } from '@/lib/notion'
import { useRouter } from 'next/router'

import { getAllPagesInSpace, getPageBreadcrumbs, idToUuid, defaultMapPageUrl } from 'notion-utils'

import Loading from '@/components/Loading'
import NotFound from '@/components/NotFound'

const Post = ({ post, blockMap, pageId }) => {
  const router = useRouter()
  if (router.isFallback) {
    return (
      <Loading notionSlug={router.asPath.split('/')[2]} />
    )
  }
  if (!post) {
    return <NotFound statusCode={404} />
  }
  return (
    <Layout
      blockMap={blockMap}
      frontMatter={post}
      fullWidth={post.fullWidth}
      pageId={pageId}
      subPage
    />
  )
}

export async function getStaticPaths() {
  const mapPageUrl = defaultMapPageUrl(BLOG.notionPageId)

  const pages = await getAllPagesInSpace(
    BLOG.notionPageId,
    BLOG.notionSpacesId,
    getPostBlocks,
    {
      traverseCollections: false
    }
  )

  const subpageIds = Object.keys(pages)
    .map((pageId) => '/s' + mapPageUrl(pageId))
    .filter((path) => path && path !== '/s/')

  // Remove post id (only Notion posts have valid UUIDs)
  const posts = await getAllPosts({ onlyNewsletter: false })
  const notionPosts = posts.filter((p) => p.source !== 'markdown')
  const postIds = Object.values(notionPosts)
    .map((postId) => '/s' + mapPageUrl(postId.id))
  const noPostsIds = subpageIds.concat(postIds).filter(v => !subpageIds.includes(v) || !postIds.includes(v))

  const heros = await getAllPosts({ onlyHidden: true })
  const notionHeros = heros.filter((p) => p.source !== 'markdown')
  const heroIds = Object.values(notionHeros)
    .map((heroId) => '/s' + mapPageUrl(heroId.id))
  const paths = noPostsIds.concat(heroIds).filter(v => !noPostsIds.includes(v) || !heroIds.includes(v))

  return {
    paths,
    fallback: true
  }
  // return {
  //   paths: [],
  //   fallback: true
  // }
}

// Module-level cache: the spaceId of the blog root page.
// Populated on the first subpage request and reused for all subsequent ones
// within the same server process.  This lets us compare against the actual
// workspace spaceId from the Notion API rather than relying on the
// NOTION_SPACES_ID env var, which may have been set using an older API format.
let _cachedRootSpaceId = null

async function getRootSpaceId() {
  if (_cachedRootSpaceId) return _cachedRootSpaceId
  try {
    const rootBlockMap = await getPostBlocks(BLOG.notionPageId)
    for (const block of Object.values(rootBlockMap.block)) {
      if (block.spaceId) {
        _cachedRootSpaceId = block.spaceId
        break
      }
      if (block.value?.space_id) {
        _cachedRootSpaceId = block.value.space_id
        break
      }
    }
  } catch (err) {
    console.warn('Could not fetch root page spaceId for pageAllowed check:', err.message)
  }
  return _cachedRootSpaceId
}

export async function getStaticProps({ params: { subpage } }) {
  const allPosts = await getAllPosts({ onlyNewsletter: false })
  const posts = allPosts.filter((p) => p.source !== 'markdown')

  let blockMap, post, breadcrumbs, activeCrumb, currentPageId
  try {
    blockMap = await getPostBlocks(subpage)
    currentPageId = idToUuid(subpage)

    breadcrumbs = getPageBreadcrumbs(blockMap, currentPageId)
    // breadcrumbs is ordered root→leaf (last element = active subpage)
    activeCrumb = breadcrumbs.at(-1)

    // Walk leaf→root to find the nearest breadcrumb that matches a known post
    // (handles both direct subpages and deeply nested pages)
    let ancestorPost = null
    for (let i = breadcrumbs.length - 1; i >= 0; i--) {
      ancestorPost = posts.find((t) => t.id === breadcrumbs[i].block.id)
      if (ancestorPost) break
    }

    if (ancestorPost) {
      // Inherit parent post metadata but use the active subpage's own title
      post = { ...ancestorPost, title: activeCrumb?.title }
    } else {
      // Page is not in the notion database at all — create a minimal post object
      post = {
        type: ['Page'],
        title: activeCrumb?.title
      }
    }
  } catch (err) {
    console.error('Error fetching subpage:', err)
    return { props: { post: null, blockMap: null, pageId: null } }
  }

  // Allow only pages in your own Notion workspace.
  // Collects spaceId values from the fetched blockMap (supporting both the
  // current `block.spaceId` camelCase format and the legacy `block.value.space_id`)
  // and verifies at least one matches either:
  //   a) the configured NOTION_SPACES_ID env var, OR
  //   b) the spaceId of the blog root page (derived at runtime and cached).
  // Checking (b) handles the case where NOTION_SPACES_ID was set using an
  // older API format and no longer matches the value returned by the API.
  const NOTION_SPACES_ID = BLOG.notionSpacesId
  const rootSpaceId = await getRootSpaceId()

  const pageAllowed = (page) => {
    const foundSpaceIds = new Set()
    Object.values(page.block).forEach(block => {
      if (block.spaceId) foundSpaceIds.add(block.spaceId)
      if (block.value?.space_id) foundSpaceIds.add(block.value.space_id)
    })

    // If no space info is present in the response, allow (API may change again)
    if (foundSpaceIds.size === 0) return true

    for (const id of foundSpaceIds) {
      // (a) match against the configured NOTION_SPACES_ID
      if (NOTION_SPACES_ID && (NOTION_SPACES_ID.includes(id) || id.includes(NOTION_SPACES_ID))) {
        return true
      }
      // (b) match against the blog root page's actual spaceId
      if (rootSpaceId && id === rootSpaceId) {
        return true
      }
    }

    return false
  }

  if (!pageAllowed(blockMap)) {
    return { props: { post: null, blockMap: null, pageId: null } }
  } else {
    return {
      props: { post, blockMap, pageId: activeCrumb?.block?.id ?? currentPageId },
      revalidate: 1
    }
  }
}

export default Post
