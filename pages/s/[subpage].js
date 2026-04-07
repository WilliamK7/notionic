import BLOG from '@/blog.config'
import Layout from '@/layouts/layout'
import { getAllPosts, getPostBlocks } from '@/lib/notion'
import { useRouter } from 'next/router'

import { getAllPagesInSpace, getPageBreadcrumbs, idToUuid, defaultMapPageUrl } from 'notion-utils'

import Loading from '@/components/Loading'
import NotFound from '@/components/NotFound'

const Post = ({ post, blockMap }) => {
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
    <Layout blockMap={blockMap} frontMatter={post} fullWidth={post.fullWidth} />
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

export async function getStaticProps({ params: { subpage } }) {
  const allPosts = await getAllPosts({ onlyNewsletter: false })
  const posts = allPosts.filter((p) => p.source !== 'markdown')

  let blockMap, post
  try {
    blockMap = await getPostBlocks(subpage)
    const id = idToUuid(subpage)

    const breadcrumbs = getPageBreadcrumbs(blockMap, id)
    // breadcrumbs is ordered root→leaf (last element = active subpage)
    const activeCrumb = breadcrumbs.at(-1)

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
    // console.log("debug: ", breadcrumbs, post)
  } catch (err) {
    console.error(err)
    return { props: { post: null, blockMap: null } }
  }

  // Allow only pages in your own space
  const NOTION_SPACES_ID = BLOG.notionSpacesId
  const pageAllowed = (page) => {
    // When page block space_id = NOTION_SPACES_ID
    let allowed = false
    Object.values(page.block).forEach(block => {
      if (!allowed && block.value && block.value.space_id) {
        allowed = NOTION_SPACES_ID.includes(block.value.space_id)
      }
    })
    return allowed
  }

  if (!pageAllowed(blockMap)) {
    return { props: { post: null, blockMap: null } }
  } else {
    return {
      props: { post, blockMap },
      revalidate: 1
    }
  }
}

export default Post
