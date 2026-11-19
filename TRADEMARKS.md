# Offlane trademark policy

Offlane's code is free software under the [GNU General Public License v3.0 or later](LICENSE). You may use, study, change and share it under that licence. This policy is about something the GPL doesn't cover: the **Offlane name and logo**. Section 7(e) of the GPL lets a licensor decline to grant rights in trademarks, and many open-source projects, such as Firefox and Thunderbird, keep their names and logos the same way.

The aim is simple: when someone sees "Offlane", they should be able to trust that it came from the Offlane project.

## The marks

- the name **Offlane™**
- the Offlane logo and app icons in [`assets/brand/`](assets/brand/)
- the Offlane wordmark in [`assets/brand/`](assets/brand/)
- the brand colour `#e5432a`, when used together with the name or logo to identify Offlane

The Offlane name and logo are trademarks of Vikash Gupta.

The files in `assets/brand/` are not covered by the GPL; they are all rights reserved (see [`REUSE.toml`](REUSE.toml)).

## Allowed without asking

- **Talking about Offlane:** articles, reviews, tutorials, videos, books, comparisons and news, using the name and showing the logo or screenshots unaltered.
- **Linking to Offlane:** linking to the website or this repository with the name, or with the logo unaltered.
- **Describing your own work truthfully:** "based on Offlane", "a fork of Offlane", "compatible with Offlane" or "a plugin for Offlane", as long as your own name is the more prominent one and it's clear the Offlane project didn't make or endorse it.
- **Sharing official builds unmodified:** redistributing an official Offlane release exactly as published, free of charge.
- **Building from source for yourself or your organisation:** builds made from this repository are labelled "Offlane (unofficial build)" and don't use Offlane's update or toolkit servers. You may use them, internally or privately, under that label.

## Needs written permission

- naming a fork, product, service, company or domain "Offlane", or anything confusingly similar (such as "Offlane Pro", "OffLane Plus" or "Offlane-NG");
- using the Offlane logo, icons or wordmark, or anything confusingly similar, on or for a modified build, or for your own product;
- distributing a modified build under the Offlane name, whether free or paid;
- selling or charging for Offlane builds, official or not, under the Offlane name;
- presenting an unofficial build as official, for example by building it with the official-build setting so that it no longer says "unofficial build";
- suggesting that the Offlane project sponsors, endorses or is affiliated with you or your work;
- using the marks in a way that is misleading or disparaging.

## If you fork Offlane

You're welcome to. Before you distribute your fork, change:

1. **The name** to one that isn't confusingly similar to Offlane. All the values are in [`src/shared/brand.ts`](src/shared/brand.ts).
2. **The bundle id** (`appBundleId` in the same file).
3. **The logo, wordmark and icons:** replace everything in [`assets/brand/`](assets/brand/), then run `npm run icons`.
4. **The website, support address and update and toolkit server addresses** in `brand.ts`, so your users reach you, not the Offlane project.

You may then say your project is "based on Offlane" or "a fork of Offlane", as described above. The GPL notices and the licence must stay as the GPL requires.

## Other names

Offlane works with programs made by others, such as FFmpeg. Their names and logos belong to their owners, and Offlane's use of them doesn't imply any endorsement.

## Questions and permission

To ask for permission or report misuse, email **offlaneapp@gmail.com**, or open an [issue](https://github.com/vkhq/offlane-app/issues) for general questions. If you're unsure whether your use is allowed, ask; most reasonable requests are approved.

This policy may be updated. The current version is always in this file.
