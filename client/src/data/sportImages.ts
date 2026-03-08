/**
 * Sport image mapping
 * Maps sport slugs to their respective image paths
 * Using the available images in public/images directory
 */

interface SportImage {
  slug: string;
  imagePath: string;
  title: string;
}

const sportImages: SportImage[] = [
  {
    slug: 'football',
    imagePath: '/images/Sports 1 (2).png',
    title: 'Football'
  },
  {
    slug: 'basketball',
    imagePath: '/images/Sports 2 (2).png',
    title: 'Basketball'
  },
  {
    slug: 'baseball',
    imagePath: '/images/Sports 3 (2).png',
    title: 'Baseball'
  },
  {
    slug: 'hockey',
    imagePath: '/images/Sports 4 (2).png',
    title: 'Hockey'
  },
  {
    slug: 'tennis',
    imagePath: '/images/image_1743932705622.png',
    title: 'Tennis'
  },
  {
    slug: 'boxing',
    imagePath: '/images/image_1743932891440.png',
    title: 'Boxing'
  },
  {
    slug: 'ufc',
    imagePath: '/images/image_1743932923834.png',
    title: 'UFC/MMA'
  },
  {
    slug: 'mma-ufc',
    imagePath: '/images/image_1743932923834.png',
    title: 'UFC/MMA'
  },
  {
    slug: 'golf',
    imagePath: '/images/image_1743933050735.png',
    title: 'Golf'
  },
  {
    slug: 'esports',
    imagePath: '/images/image_1743933103859.png',
    title: 'Esports'
  },
  {
    slug: 'cricket',
    imagePath: '/images/image_1743933557700.png',
    title: 'Cricket'
  },
  {
    slug: 'racing',
    imagePath: '/images/image_1743947434959.png',
    title: 'Racing'
  },
  // Added missing sports from database using available images
  {
    slug: 'volleyball',
    imagePath: '/images/Sports 3 (2).png', // Using baseball image as fallback
    title: 'Volleyball'
  },
  {
    slug: 'table-tennis',
    imagePath: '/images/Sports 2 (2).png', // Using basketball image as fallback
    title: 'Table Tennis'
  },
  {
    slug: 'rugby-league',
    imagePath: '/images/Sports 1 (2).png', // Using football image as fallback
    title: 'Rugby League'
  },
  {
    slug: 'rugby-union',
    imagePath: '/images/Sports 1 (2).png', // Using football image as fallback
    title: 'Rugby Union'
  },
  {
    slug: 'horse-racing',
    imagePath: '/images/image_1743947434959.png', // Using racing image
    title: 'Horse Racing'
  },
  {
    slug: 'greyhounds',
    imagePath: '/images/image_1743947434959.png', // Using racing image
    title: 'Greyhounds'
  },
  {
    slug: 'afl',
    imagePath: '/images/Sports 1 (2).png',
    title: 'AFL'
  },
  {
    slug: 'wwe',
    imagePath: '/images/image_1743932923834.png',
    title: 'WWE Entertainment'
  },
  {
    slug: 'wwe-entertainment',
    imagePath: '/images/image_1743932923834.png',
    title: 'WWE Entertainment'
  },
  {
    slug: 'entertainment',
    imagePath: '/images/image_1743932923834.png',
    title: 'WWE Entertainment'
  }
];

export default sportImages;