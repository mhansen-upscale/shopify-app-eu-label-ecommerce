-- AlterTable
ALTER TABLE "ShopConfig" ADD COLUMN "emailSnippetAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RenderedFile" (
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderedFile_pkey" PRIMARY KEY ("shop","key")
);
