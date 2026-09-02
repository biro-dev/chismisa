-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "mediaDuration" INTEGER,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaThumb" TEXT,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mediaDuration" INTEGER,
ADD COLUMN     "mediaSize" INTEGER,
ADD COLUMN     "mediaThumb" TEXT,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT;
